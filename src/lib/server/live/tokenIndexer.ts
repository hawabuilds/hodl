import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  type Abi,
  type PublicClient,
} from "viem";
import {robinhoodMainnet} from "@/config/chain";
import {
  CATCHUP_REORG,
  MIN_LOG_WINDOW,
  cursorAfterLogScan,
  getLogsStartWindow,
  isLiveCaughtUp,
  liveReorgBlocks,
  liveScanMaxBlocks,
  LogScanLimiter,
  resumeIfPersisted,
  shrinkLogWindow,
  shouldUseAlchemyForLogs,
} from "./logScan";
import {
  ALL_FACTORIES,
  LONG_AIRLOCK_FACTORY,
  PONS_V2_FACTORY,
  type FactorySpec,
} from "@/lib/contracts";
import {
  qualifiesForUniverse,
  quoteKindFor,
  statusFor,
  type QuoteKind,
} from "@/lib/universe";
import {RWA_BY_ADDRESS} from "./robinhood";
import {rpc, erc20Abi} from "./chain";
import {
  cursorsFor,
  replaceTokenPools,
  upsertTokens,
  writeCursor,
  writeCursors,
  type TokenWrite,
} from "./universeStore";
import {discoverV3Pools, pickBestPool} from "./v3Pools";
import {commitListedWithPrice, refreshOnchainPrices} from "./onchainPrice";
import {persistResolvedImages} from "./tokenImages";
import {rewardRwaFor} from "./rewardDetect";
import {asAddress as parseAddress, normalizeAddress} from "@/lib/address";
import {longWriteEligible} from "@/lib/longAuthenticity";
import {resolveLongAuthenticity} from "./longAuthenticity";
import {hasDatabase} from "../db";
import {isRpcRateLimitError, PUBLIC_MAINNET_RPC} from "./rpcProviders";

const PUBLIC_RPC = PUBLIC_MAINNET_RPC;
const REORG = CATCHUP_REORG;
const BUDGET_MS = 45_000;

const logsClient = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(PUBLIC_RPC, {timeout: 30_000, retryCount: 0}),
});

let alchemyLogs: PublicClient | null | undefined;
let chainstackLogs: PublicClient | null | undefined;

function alchemyLogsClient(): PublicClient | null {
  if (alchemyLogs !== undefined) return alchemyLogs;
  const url = process.env.ALCHEMY_RPC_URL?.trim();
  alchemyLogs = url
    ? createPublicClient({
        chain: robinhoodMainnet,
        transport: http(url, {timeout: 30_000, retryCount: 0}),
      })
    : null;
  return alchemyLogs;
}

function chainstackLogsClient(): PublicClient | null {
  if (chainstackLogs !== undefined) return chainstackLogs;
  const url = process.env.CHAINSTACK_RPC_URL?.trim();
  chainstackLogs = url?.startsWith("https://")
    ? createPublicClient({
        chain: robinhoodMainnet,
        transport: http(url, {timeout: 30_000, retryCount: 0}),
      })
    : null;
  return chainstackLogs;
}

type LogsProvider = "alchemy" | "chainstack" | "public";

function logsProviders(): {client: PublicClient; provider: LogsProvider}[] {
  const out: {client: PublicClient; provider: LogsProvider}[] = [
    {client: logsClient, provider: "public"},
  ];
  const chainstack = chainstackLogsClient();
  if (chainstack) out.unshift({client: chainstack, provider: "chainstack"});
  const alchemy = alchemyLogsClient();
  if (alchemy) out.unshift({client: alchemy, provider: "alchemy"});
  return out;
}

function logsProviderKind(provider: LogsProvider): boolean {
  return provider === "alchemy";
}

const logLimiter = new LogScanLimiter();
let logsGate: Promise<unknown> = Promise.resolve();

function withLogsGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = logsGate.then(fn, fn);
  logsGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function eventLogKey(address: `0x${string}`, event: ReturnType<typeof parseAbiItem>): string {
  const name = "name" in event && typeof event.name === "string" ? event.name : "?";
  return `${address.toLowerCase()}:${name}`;
}

const HEAD_TIMEOUT_MS = 8_000;
const HEAD_CACHE_MS = 8_000;
let cachedHead: {value: bigint; at: number} | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // Node clamps setTimeout(Infinity) to a tiny delay, so an unbounded
  // admin job would abort on the first getLogs.
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PONS_V2_LAUNCHED = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const PONS_V2_GRADUATED = parseAbiItem(
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
);
const PONS_V1_LAUNCHED = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)",
);
const AIRLOCK_CREATE = parseAbiItem(
  "event Create(address asset, address indexed numeraire, address initializer, address poolOrHook)",
);

const ponsLaunchAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const ponsV1LaunchAbi = parseAbi([
  "function getLaunchedToken(address) view returns (address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount)",
  "function graduationStatus(address) view returns (uint256 current,uint256 threshold,bool graduated)",
]);
const longAssetAbi = parseAbi([
  "function getAssetData(address) view returns (address numeraire,address timelock,address governance,address liquidityMigrator,address poolInitializer,address pool)",
]);

const POOL_CREATED = 2;

export interface IndexPass {
  factory: string;
  from: string;
  to: string;
  /** Block written to the cursor. Differs from `to` when writeCap truncates. */
  cursorTo: string;
  upserts: number;
  unresolvedRewards: string[];
}

async function head(): Promise<bigint> {
  // Public RPC is the live tip. Alchemy has sat hundreds of thousands of
  // blocks behind and waiting on it ate the cron budget. getLogs uses
  // Alchemy HTTP whenever it is set (catch-up and subscribe). Block number
  // must not. Never fall back to Alchemy for head — a stale tip freezes
  // live cursors as if the chain had stopped.
  if (cachedHead && Date.now() - cachedHead.at < HEAD_CACHE_MS) {
    return cachedHead.value;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pub = await withTimeout(
        logsClient.getBlockNumber(),
        HEAD_TIMEOUT_MS,
        "public head",
      );
      if (pub === 0n) {
        throw new Error("token indexer could not read chain head");
      }
      cachedHead = {value: pub, at: Date.now()};
      return pub;
    } catch (error) {
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("token indexer could not read chain head");
}

interface LaunchLog {
  blockNumber: bigint;
  args?: {
    token?: unknown;
    asset?: unknown;
    pairToken?: unknown;
    numeraire?: unknown;
    poolOrHook?: unknown;
    curve?: unknown;
  };
}

interface LogFetch {
  logs: LaunchLog[];
  scannedTo: bigint | null;
  complete: boolean;
}

function emptyFetch(complete = true): LogFetch {
  return {logs: [], scannedTo: null, complete};
}

function logScanBackingOff(): boolean {
  return logLimiter.strikes > 0 || logLimiter.remainingCooldown() > 0;
}

async function logs(
  address: `0x${string}`,
  event: ReturnType<typeof parseAbiItem>,
  from: bigint,
  to: bigint,
  opts: {
    caughtUp?: boolean;
    live?: boolean;
    persistedCursor?: bigint;
    deadline?: number;
  } = {},
): Promise<LogFetch> {
  return withLogsGate(() => logsUnlocked(address, event, from, to, opts));
}

async function logsUnlocked(
  address: `0x${string}`,
  event: ReturnType<typeof parseAbiItem>,
  from: bigint,
  to: bigint,
  opts: {
    caughtUp?: boolean;
    live?: boolean;
    persistedCursor?: bigint;
    deadline?: number;
  } = {},
): Promise<LogFetch> {
  const out: LaunchLog[] = [];
  if (to < from) return emptyFetch(true);
  const span = to - from + 1n;
  const providers = logsProviders();
  const alchemy = alchemyLogsClient();
  const preferAlchemy = shouldUseAlchemyForLogs({
    hasAlchemy: Boolean(alchemy),
    caughtUp: Boolean(opts.caughtUp),
    span,
  });
  let providerIndex = 0;
  if (!preferAlchemy) {
    while (
      providerIndex < providers.length - 1 &&
      providers[providerIndex].provider === "alchemy"
    ) {
      providerIndex += 1;
    }
  }
  let client = providers[providerIndex].client;
  let usingProvider = providers[providerIndex].provider;
  let startWindow = getLogsStartWindow({
    caughtUp: Boolean(opts.caughtUp),
    alchemy: logsProviderKind(usingProvider),
    live: Boolean(opts.live),
    span,
  });
  let window = startWindow;
  const key = eventLogKey(address, event);
  const persisted = opts.persistedCursor ?? from;
  const cursorStart =
    opts.live || opts.caughtUp
      ? resumeIfPersisted(logLimiter.lastOk.get(key), from, persisted)
      : from;
  if (cursorStart > to) {
    // In-memory lastOk jumped past this window after a discarded 429 pass.
    // Do not treat the window as fetched.
    return emptyFetch(false);
  }
  let cursor = cursorStart;
  let scannedTo: bigint | null = null;
  let challenged = 0;
  while (cursor <= to) {
    if (opts.deadline != null && Date.now() > opts.deadline) {
      return {logs: out, scannedTo, complete: false};
    }
    const cooldown = logLimiter.remainingCooldown();
    if (cooldown > 0) {
      await sleep(cooldown);
    }

    const end = cursor + window - 1n > to ? to : cursor + window - 1n;
    try {
      const batch = await client.getLogs({
        address,
        event: event as never,
        fromBlock: cursor,
        toBlock: end,
      });
      out.push(...(batch as LaunchLog[]));
      logLimiter.noteOk(key, end);
      scannedTo = end;
      cursor = end + 1n;
      if (window < startWindow) window *= 2n;
    } catch (error) {
      const text = String(error);
      if (/403|cloudflare|just a moment|cf-mitigated/i.test(text)) {
        challenged += 1;
        if (challenged > 2) {
          console.error(
            "RPC challenged repeatedly; leaving cursor at last fetched block",
            scannedTo?.toString() ?? "none",
            cursor.toString(),
            end.toString(),
          );
          return {logs: out, scannedTo, complete: false};
        }
        console.error("public RPC challenged; retrying getLogs in 20s", cursor.toString(), end.toString());
        await sleep(20_000);
        continue;
      }
      if (
        isRpcRateLimitError(text) ||
        /Archive, Debug and Trace|not available on your current plan|ResourceUnavailableRpcError|-32002/i.test(
          text,
        )
      ) {
        if (providerIndex + 1 < providers.length) {
          providerIndex += 1;
          client = providers[providerIndex].client;
          usingProvider = providers[providerIndex].provider;
          startWindow = getLogsStartWindow({
            caughtUp: Boolean(opts.caughtUp),
            alchemy: logsProviderKind(usingProvider),
            live: Boolean(opts.live),
            span,
          });
          window = startWindow;
          console.error(
            `getLogs ${text.slice(0, 80)}; retrying on ${usingProvider}`,
            cursor.toString(),
            end.toString(),
          );
          continue;
        }
        if (isRpcRateLimitError(text)) {
          window = shrinkLogWindow(window);
          const wait = logLimiter.note429(cursor, end);
          console.error("getLogs 429; backing off", wait, cursor.toString(), end.toString());
          await sleep(wait);
          continue;
        }
      }
      const capped =
        /exceeds|limit|range|invalid parameters|query returned more/i.test(
          text,
        );
      if (!capped || window <= MIN_LOG_WINDOW) {
        console.error("token indexer logs failed", address, cursor, end, error);
        if (window <= MIN_LOG_WINDOW) {
          return {logs: out, scannedTo, complete: false};
        }
        window = shrinkLogWindow(window);
        continue;
      }
      window = shrinkLogWindow(window);
    }
  }
  return {logs: out, scannedTo: scannedTo ?? to, complete: true};
}

function asAddress(value: unknown): string | null {
  return parseAddress(value);
}

function quoteOf(pair: string | null): {kind: QuoteKind | null; token: string | null} {
  if (!pair) return {kind: null, token: null};
  const address = normalizeAddress(pair);
  const rwa = RWA_BY_ADDRESS.get(address);
  if (rwa) return {kind: "rwa", token: address};
  return {kind: quoteKindFor(address, false), token: address};
}

async function meta(address: string): Promise<{symbol: string; name: string; decimals: number; supply: number | null}> {
  try {
    const [symbol, name, decimals, supply] = await Promise.all([
      rpc().readContract({address: address as `0x${string}`, abi: erc20Abi, functionName: "symbol"}).catch(() => "???"),
      rpc().readContract({
        address: address as `0x${string}`,
        abi: parseAbi(["function name() view returns (string)"]),
        functionName: "name",
      }).catch(() => "Unknown"),
      rpc().readContract({address: address as `0x${string}`, abi: erc20Abi, functionName: "decimals"}).catch(() => 18),
      rpc().readContract({address: address as `0x${string}`, abi: erc20Abi, functionName: "totalSupply"}).catch(() => null),
    ]);
    const dec = Number(decimals);
    const raw = supply == null ? null : Number(supply) / 10 ** (Number.isFinite(dec) ? dec : 18);
    return {
      symbol: String(symbol),
      name: String(name),
      decimals: Number.isFinite(dec) ? dec : 18,
      supply: raw != null && Number.isFinite(raw) ? raw : null,
    };
  } catch {
    return {symbol: "???", name: "Unknown", decimals: 18, supply: null};
  }
}

const blockTimes = new Map<string, string>();

async function blockTime(block: bigint): Promise<string> {
  const key = block.toString();
  const hit = blockTimes.get(key);
  if (hit) return hit;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const header = await logsClient.getBlock({blockNumber: block});
      const iso = new Date(Number(header.timestamp) * 1000).toISOString();
      blockTimes.set(key, iso);
      return iso;
    } catch (error) {
      lastError = error;
      const text = String(error);
      if (/429|too many requests|rate limit/i.test(text)) {
        await sleep(Math.min(4_000 * 2 ** attempt, 20_000));
        continue;
      }
      if (attempt < 3) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`blockTime ${key} failed`);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({length: Math.min(limit, Math.max(items.length, 1))}, () => worker()),
  );
  return out;
}

async function ponsRecord(factory: `0x${string}`, token: string) {
  try {
    const launch = await rpc().readContract({
      address: factory,
      abi: ponsLaunchAbi as Abi,
      functionName: "getLaunchedToken",
      args: [token as `0x${string}`],
    });
    if (launch && typeof launch === "object" && "exists" in launch && launch.exists) {
      return launch as {
        pairToken: `0x${string}`;
        creatorFeeRecipient: `0x${string}`;
        deployer: `0x${string}`;
        creatorTaxBps: number;
        phase: number;
        exists: boolean;
      };
    }
  } catch {
    // V1 shape
  }
  try {
    const launch = await rpc().readContract({
      address: factory,
      abi: ponsV1LaunchAbi,
      functionName: "getLaunchedToken",
      args: [token as `0x${string}`],
    });
    const paired = Array.isArray(launch) ? launch[2] : (launch as {pairedToken?: string}).pairedToken;
    const exists = Array.isArray(launch) ? launch[11] : (launch as {exists?: boolean}).exists;
    const deployer = Array.isArray(launch) ? launch[1] : (launch as {deployer?: string}).deployer;
    if (!exists) return null;
    return {
      pairToken: paired as `0x${string}`,
      creatorFeeRecipient: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      deployer: deployer as `0x${string}`,
      creatorTaxBps: 0,
      phase: 0,
      exists: true,
    };
  } catch {
    return null;
  }
}

async function ponsBonded(factory: `0x${string}`, token: string, phase: number | null): Promise<boolean> {
  if (phase != null && phase >= POOL_CREATED) return true;
  try {
    const status = await rpc().readContract({
      address: factory,
      abi: ponsV1LaunchAbi,
      functionName: "graduationStatus",
      args: [token as `0x${string}`],
    });
    const graduated = Array.isArray(status) ? status[2] : (status as {graduated?: boolean}).graduated;
    return Boolean(graduated);
  } catch {
    return false;
  }
}

function rowQualifies(row: TokenWrite): boolean {
  return qualifiesForUniverse({
    launchpad: row.launchpad,
    quoteKind: row.quote_kind ?? null,
    rewardRwa: row.reward_rwa ?? null,
    bonded: Boolean(row.bonded_at) || row.launchpad === "long",
  });
}

async function writePons(
  factory: FactorySpec,
  token: string,
  pairHint: string | null,
  curveHint: string | null,
  block: bigint,
  forceBonded: boolean,
  unresolved: string[],
): Promise<TokenWrite | null> {
  const record = await withTimeout(
    ponsRecord(factory.address, token),
    8_000,
    "pons record",
  ).catch(() => null);
  const pair = asAddress(record?.pairToken) ?? pairHint;
  const quote = quoteOf(pair);
  const bonded =
    forceBonded ||
    (await withTimeout(
      ponsBonded(factory.address, token, record?.phase ?? null),
      6_000,
      "pons bonded",
    ).catch(() => false));
  const reward = await withTimeout(
    rewardRwaFor(token, record?.creatorFeeRecipient ?? null),
    4_000,
    "reward detect",
  ).catch(() => null);
  if (
    (quote.kind === "eth" || quote.kind === "usdg") &&
    !reward
  ) {
    unresolved.push(token);
  }
  const info = await withTimeout(meta(token), 6_000, "token meta").catch(() => ({
    symbol: "???",
    name: "Unknown",
    decimals: 18,
    supply: null,
  }));
  const at = await blockTime(block);
  const status = statusFor({launchpad: "pons", bonded});
  const launchpadContract = curveHint;
  const row: TokenWrite = {
    address: token,
    launchpad: "pons",
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    ...(launchpadContract
      ? {pair_address: launchpadContract, launchpad_contract: launchpadContract}
      : {}),
    quote_token: quote.token,
    quote_kind: quote.kind,
    reward_rwa: reward?.ticker ?? null,
    reward_kind: reward?.kind ?? null,
    creator: asAddress(record?.deployer),
    tax_buy: record ? Number(record.creatorTaxBps) / 100 : null,
    tax_sell: record ? Number(record.creatorTaxBps) / 100 : null,
    total_supply: info.supply,
    created_at: at,
    bonded_at: bonded ? at : null,
    listed_at: bonded ? at : null,
    status,
    eligible: true,
  };
  if (!rowQualifies(row)) return null;
  return row;
}

async function writeLong(
  token: string,
  numeraire: string | null,
  pool: string | null,
  block: bigint,
  unresolved: string[],
): Promise<TokenWrite | null> {
  let quoteAddr = numeraire;
  if (!quoteAddr) {
    try {
      const data = await rpc().readContract({
        address: LONG_AIRLOCK_FACTORY.address,
        abi: longAssetAbi,
        functionName: "getAssetData",
        args: [token as `0x${string}`],
      });
      quoteAddr = asAddress(Array.isArray(data) ? data[0] : (data as {numeraire?: string}).numeraire);
      pool = pool ?? asAddress(Array.isArray(data) ? data[5] : (data as {pool?: string}).pool);
    } catch {
      // leave quote unknown
    }
  }
  const quote = quoteOf(quoteAddr ?? null);
  const reward = await withTimeout(rewardRwaFor(token, null), 4_000, "reward detect").catch(
    () => null,
  );
  if ((quote.kind === "eth" || quote.kind === "usdg") && !reward) {
    unresolved.push(token);
  }
  const info = await withTimeout(meta(token), 6_000, "token meta").catch(() => ({
    symbol: "???",
    name: "Unknown",
    decimals: 18,
    supply: null,
  }));
  const auth = await withTimeout(
    resolveLongAuthenticity(token),
    8_000,
    "long authenticity",
  ).catch(() => null);
  const at = await blockTime(block);
  const row: TokenWrite = {
    address: token,
    launchpad: "long",
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    pair_address: pool,
    launchpad_contract: pool,
    quote_token: quote.token,
    quote_kind: quote.kind,
    reward_rwa: reward?.ticker ?? null,
    reward_kind: reward?.kind ?? null,
    creator: null,
    total_supply: info.supply,
    created_at: at,
    bonded_at: null,
    listed_at: at,
    status: "listed",
    eligible: longWriteEligible(auth),
  };
  if (!rowQualifies(row)) return null;
  return row;
}

function capByBlock<T>(
  items: T[],
  blockOf: (item: T) => bigint,
  cap: number | undefined,
): {items: T[]; endAt: bigint | null} {
  if (!cap || items.length <= cap) return {items, endAt: null};
  const sorted = [...items].sort((a, b) => {
    const delta = blockOf(a) - blockOf(b);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  });
  const slice = sorted.slice(0, cap);
  return {items: slice, endAt: blockOf(slice[slice.length - 1])};
}

export async function indexFactory(
  factory: FactorySpec,
  maxBlocks: bigint,
  deadline: number,
  cursorName = `tokens:${factory.id}`,
  extras: {
    skipImages?: boolean;
    writeCap?: number;
    writeConcurrency?: number;
    batchPauseMs?: number;
    storedCursor?: bigint;
    bondedOnly?: boolean;
    /** Stop at this block even if head is further (gap walks toward live). */
    untilBlock?: bigint;
    /** Gap job may spend longer than the cron's 12s write cap. */
    writeTimeoutMs?: number;
    /** Admin gap job writes tokens via DATABASE_URL, not PostgREST. */
    persistWrites?: (rows: TokenWrite[]) => Promise<void>;
    /** Process-lifetime dedupe so a 30-block reorg overlap does not re-fetch. */
    seenTokens?: Set<string>;
    cursorTimeoutMs?: number;
  } = {},
): Promise<IndexPass> {
  const tip = await head();
  const stored =
    extras.storedCursor ??
    (await readCursors([cursorName], undefined, extras.cursorTimeoutMs)).get(cursorName) ??
    0n;
  const behind = tip > stored ? tip - stored : 0n;
  const isLive = cursorName.endsWith(":live") && !cursorName.endsWith(":live-gap");
  const caughtUp = isLive && isLiveCaughtUp(behind);
  const reorg = liveReorgBlocks(caughtUp);
  const start = stored > 0n ? (stored > reorg ? stored - reorg : 0n) : factory.deployedAtBlock;
  const cap = extras.untilBlock != null && extras.untilBlock < tip ? extras.untilBlock : tip;
  const allowed = isLive && maxBlocks > liveScanMaxBlocks(behind) ? liveScanMaxBlocks(behind) : maxBlocks;
  const end = start + allowed > cap ? cap : start + allowed;
  const unresolved: string[] = [];
  const writes: TokenWrite[] = [];
  let scanComplete = true;
  let scannedTo: bigint | null = null;
  let writeCapEnd: bigint | null = null;

  if (Date.now() > deadline || end <= start) {
    return {
      factory: factory.id,
      from: start.toString(),
      to: start.toString(),
      cursorTo: stored.toString(),
      upserts: 0,
      unresolvedRewards: [],
    };
  }

  const remain = () => Math.max(deadline - Date.now(), 1);
  const mergeFetch = (result: LogFetch) => {
    if (!result.complete) scanComplete = false;
    if (result.scannedTo == null) return result.logs;
    scannedTo =
      scannedTo == null || result.scannedTo < scannedTo ? result.scannedTo : scannedTo;
    return result.logs;
  };
  const logsUntil = async (
    address: `0x${string}`,
    event: ReturnType<typeof parseAbiItem>,
    from: bigint,
    to: bigint,
    label: string,
  ) => {
    try {
      return mergeFetch(
        await withTimeout(
          logs(address, event, from, to, {
            caughtUp,
            live: isLive,
            persistedCursor: stored,
            deadline,
          }),
          remain(),
          label,
        ),
      );
    } catch (error) {
      scanComplete = false;
      console.error(`${label} aborted; keeping cursor at last fetched block`, error);
      return [];
    }
  };

  if (factory.launchpad === "pons") {
    const v2 = factory.address === PONS_V2_FACTORY.address;
    const launched = await logsUntil(
      factory.address,
      v2 ? PONS_V2_LAUNCHED : PONS_V1_LAUNCHED,
      start,
      end,
      `${factory.id} launched logs`,
    );
    const jobs: {
      token: string;
      pair: string | null;
      curve: string | null;
      block: bigint;
      bonded: boolean;
    }[] = [];
    const seen = new Set<string>();
    const addJob = (
      token: string | null,
      pair: string | null,
      curve: string | null,
      block: bigint,
      bonded: boolean,
    ) => {
      if (!token) return;
      if (extras.seenTokens?.has(token) && !bonded) return;
      const held = jobs.find((job) => job.token === token);
      if (held) {
        if (bonded) held.bonded = true;
        if (pair && !held.pair) held.pair = pair;
        if (curve && !held.curve) held.curve = curve;
        return;
      }
      seen.add(token);
      jobs.push({token, pair, curve, block, bonded});
    };
    if (!v2 && launched.length === 0) {
      const alt = await logsUntil(factory.address, PONS_V2_LAUNCHED, start, end, `${factory.id} alt launched logs`);
      for (const log of alt) {
        addJob(
          asAddress(log.args?.token),
          asAddress(log.args?.pairToken),
          asAddress(log.args?.curve),
          log.blockNumber,
          false,
        );
      }
    }
    for (const log of launched) {
      addJob(
        asAddress(log.args?.token),
        asAddress(log.args?.pairToken),
        asAddress(log.args?.curve),
        log.blockNumber,
        false,
      );
    }
    if (v2) {
      const graduated = await logsUntil(factory.address, PONS_V2_GRADUATED, start, end, `${factory.id} graduated logs`);
      for (const log of graduated) {
        addJob(asAddress(log.args?.token), null, null, log.blockNumber, true);
      }
    }
    const persist = extras.bondedOnly ? jobs.filter((job) => job.bonded) : jobs;
    const capped = capByBlock(persist, (job) => job.block, extras.writeCap);
    writeCapEnd = capped.endAt;
    const rows = await mapLimit(capped.items, extras.writeConcurrency ?? 8, (job) =>
      writePons(factory, job.token, job.pair, job.curve, job.block, job.bonded, unresolved),
    );
    for (const row of rows) if (row) writes.push(row);
  } else if (factory.id === "long-airlock") {
    const created = await logsUntil(factory.address, AIRLOCK_CREATE, start, end, `${factory.id} create logs`);
    const capped = capByBlock(created, (log) => log.blockNumber, extras.writeCap);
    writeCapEnd = capped.endAt;
    const rows = await mapLimit(capped.items, extras.writeConcurrency ?? 8, (log) => {
      const token = asAddress(log.args?.asset);
      if (!token) return Promise.resolve(null);
      if (extras.seenTokens?.has(token)) return Promise.resolve(null);
      return writeLong(
        token,
        asAddress(log.args?.numeraire),
        asAddress(log.args?.poolOrHook),
        log.blockNumber,
        unresolved,
      );
    });
    for (const row of rows) if (row) writes.push(row);
  }

  const cursorTo = cursorAfterLogScan({
    stored,
    plannedEnd: end,
    scannedTo,
    complete: scanComplete,
    writeCapEnd,
  });

  let persistFailed = false;
  if (writes.length > 0) {
    let poolRows: {token: string; pool: string; fee: number; quote: string; liquidity: bigint}[] = [];
    try {
      poolRows = await withTimeout(
        attachResolvedPools(writes),
        Math.min(remain(), 6_000),
        "v3 pool resolve",
      );
    } catch (error) {
      console.error("v3 pool resolve failed; tokens still upserted", error);
    }
    const writeBudget =
      extras.writeTimeoutMs ??
      (deadline === Number.POSITIVE_INFINITY ? 180_000 : Math.min(remain(), 12_000));
    if (extras.persistWrites) {
      await extras.persistWrites(writes);
    } else {
      try {
        await withTimeout(commitListedWithPrice(writes), writeBudget, "token upsert");
      } catch (error) {
        console.error("priced token upsert failed; listing without price", error);
        await withTimeout(upsertTokens(writes), Math.min(remain(), 30_000), "token upsert fallback");
      }
    }
    if (poolRows.length > 0) {
      try {
        await replaceTokenPools(poolRows);
      } catch (error) {
        console.error("token_pools write failed", error);
      }
    }
    if (!extras.skipImages) {
      try {
        await persistResolvedImages(
          writes.map((row) => ({address: row.address, launchpad: row.launchpad})),
        );
      } catch (error) {
        persistFailed = true;
        console.error("token image persist failed; tokens still upserted", error);
      }
    }
    if ((extras.batchPauseMs ?? 0) > 0) {
      await sleep(extras.batchPauseMs!);
    }
  }
  if (extras.seenTokens && rememberSeenAfterImages(persistFailed)) {
    for (const row of writes) extras.seenTokens.add(normalizeAddress(row.address));
  }
  if (cursorTo !== stored && !extras.persistWrites) {
    try {
      await withTimeout(writeCursor(cursorName, cursorTo), 8_000, "cursor write");
    } catch (error) {
      console.error(`cursor write ${cursorName} failed; tokens still upserted`, error);
    }
  }
  return {
    factory: cursorName.replace(/^tokens:/, ""),
    from: start.toString(),
    to: end.toString(),
    cursorTo: cursorTo.toString(),
    upserts: writes.length,
    unresolvedRewards: unresolved,
  };
}

/**
 * One indexer pass. Walks each factory from its cursor, upserts tokens,
 * then refreshes stats. A stats failure is logged and ignored.
 */
export interface IndexOptions {
  maxBlocks?: bigint;
  /** 0 means no deadline. Cron uses the default budget. */
  budgetMs?: number;
  refreshStats?: boolean;
  factoryId?: string;
  /**
   * Drain the chain tip before walking history. New launches must not wait
   * for a 20-million-block backfill cursor to arrive.
   */
  live?: boolean;
  /** Cron sets false — history is a different job and blows the 60s limit. */
  historical?: boolean;
  /** Cron skips. The Railway worker resolves on insert. */
  skipImages?: boolean;
  /** Cap new rows per factory so one busy window cannot eat the whole minute. */
  writeCap?: number;
  /** Token meta fetches per factory. Live tip stays at 1. */
  writeConcurrency?: number;
  /** Sleep after a factory that wrote rows. */
  batchPauseMs?: number;
  /**
   * Drain parked `live-gap` cursors. Cron must leave this false — sequential
   * gap scans are why the tip never persisted before the 60s kill.
   */
  drainGap?: boolean;
  /** Admin gap job preloads from Postgres so a slow PostgREST cannot stall. */
  heldCursors?: Map<string, bigint>;
  /** Admin gap job persists tokens via DATABASE_URL. Cron must omit this. */
  persistWrites?: (rows: TokenWrite[]) => Promise<void>;
  /** Process-lifetime dedupe across live-tip ticks. */
  seenTokens?: Set<string>;
  /** Backfill scripts may wait longer on a cold PostgREST. */
  cursorTimeoutMs?: number;
}

/**
 * Persist throw must not add the address — a 30-block reorg overlap
 * can retry images. A Dex miss (0 writes) still marks seen.
 */
export function rememberSeenAfterImages(persistFailed: boolean): boolean {
  return !persistFailed;
}

/**
 * How far behind head a brand-new live cursor starts.
 *
 * Robinhood blocks are ~100ms, so 12k blocks is about twenty minutes — enough
 * to cover a missed cron without walking the whole chain.
 */
const LIVE_LOOKBACK = 12_000n;

export function invalidateHeadCache(): void {
  cachedHead = null;
}

/** Public chain tip. Live indexing must not use Alchemy for this. */
export async function readChainHead(): Promise<bigint> {
  return head();
}

export function liveTipCursorNames(): string[] {
  return liveFactoryList().flatMap((factory) => [
    `tokens:${factory.id}:live`,
    `tokens:${factory.id}:live-gap`,
  ]);
}

function liveFactoryList(): FactorySpec[] {
  return [
    ...ALL_FACTORIES.filter((factory) => factory.id === "pons-v2" || factory.id === "long-airlock"),
    ...ALL_FACTORIES.filter((factory) => factory.id === "pons-v1" || factory.id === "pons-legacy"),
  ];
}

function emptyPass(factory: string): IndexPass {
  return {factory, from: "0", to: "0", cursorTo: "0", upserts: 0, unresolvedRewards: []};
}

async function readCursors(
  names: string[],
  held?: Map<string, bigint>,
  timeoutMs = 8_000,
): Promise<Map<string, bigint>> {
  if (held) {
    const map = new Map<string, bigint>();
    for (const name of names) map.set(name, held.get(name) ?? 0n);
    return map;
  }
  return withTimeout(cursorsFor(names), timeoutMs, "cursor read");
}

/**
 * Index only the tip. Shares upserts with history (same address is the same
 * row) and keeps its own cursors so a historical pass cannot forget a coin
 * that launched this minute. Never drains `live-gap`.
 */
async function indexLiveTip(
  deadline: number,
  maxBlocks: bigint,
  extras: {
    skipImages?: boolean;
    writeCap?: number;
    writeConcurrency?: number;
    batchPauseMs?: number;
    heldCursors?: Map<string, bigint>;
    persistWrites?: (rows: TokenWrite[]) => Promise<void>;
    seenTokens?: Set<string>;
  } = {},
): Promise<IndexPass[]> {
  const factoryExtras = {
    skipImages: extras.skipImages,
    writeCap: extras.writeCap,
    writeConcurrency: extras.writeConcurrency ?? 1,
    batchPauseMs: extras.batchPauseMs,
    persistWrites: extras.persistWrites,
    seenTokens: extras.seenTokens,
    bondedOnly: true,
  };
  const tip = await head();
  const out: IndexPass[] = [];
  const window = maxBlocks > 0n ? maxBlocks : LIVE_LOOKBACK;
  const liveFactories = liveFactoryList();

  const liveKeys = liveFactories.map((factory) => `tokens:${factory.id}:live`);
  const gapKeys = liveFactories.map((factory) => `tokens:${factory.id}:live-gap`);
  const held = await readCursors([...liveKeys, ...gapKeys], extras.heldCursors);

  const latchWrites: {name: string; block: bigint}[] = [];
  for (const factory of liveFactories) {
    const liveKey = `tokens:${factory.id}:live`;
    const stored = held.get(liveKey) ?? 0n;
    if (stored === 0n) {
      const seed = tip > LIVE_LOOKBACK ? tip - LIVE_LOOKBACK : factory.deployedAtBlock;
      latchWrites.push({name: liveKey, block: seed});
      held.set(liveKey, seed);
    } else if (
      !logScanBackingOff() &&
      tip > stored &&
      tip - stored > LIVE_LOOKBACK
    ) {
      // Small tip windows cannot recover a multi-hour stall. Latch to the
      // tip so this minute's launches show; park the hole on live-gap for
      // a local/admin job. Cron must not drain that gap. A 429 storm must
      // not latch over unfetched logs and report behind=0.
      const gapKey = `tokens:${factory.id}:live-gap`;
      const gapHeld = held.get(gapKey) ?? 0n;
      if (gapHeld === 0n || gapHeld > stored) {
        latchWrites.push({name: gapKey, block: stored});
        held.set(gapKey, stored);
      }
      const seed = tip > window ? tip - window + REORG : 0n;
      console.warn(
        `live cursor ${liveKey} lagged ${tip - stored} blocks; latching to ${seed}`,
      );
      latchWrites.push({name: liveKey, block: seed});
      held.set(liveKey, seed);
    }
  }
  if (latchWrites.length > 0) {
    try {
      await withTimeout(writeCursors(latchWrites), 8_000, "cursor latch");
    } catch (error) {
      console.error("live cursor latch failed; scanning from in-memory seeds", error);
    }
  }

  const priority = liveFactories.filter(
    (factory) => factory.id === "pons-v2" || factory.id === "long-airlock",
  );
  const secondary = liveFactories.filter(
    (factory) => factory.id === "pons-v1" || factory.id === "pons-legacy",
  );
  // Scan budget starts after PostgREST latch chatter, not at cron start.
  const scanDeadline =
    deadline === Number.POSITIVE_INFINITY ? deadline : Math.min(deadline, Date.now() + 18_000);
  async function scanLive(factory: FactorySpec): Promise<IndexPass> {
    const liveKey = `tokens:${factory.id}:live`;
    try {
      return await indexFactory(factory, window, scanDeadline, liveKey, {
        ...factoryExtras,
        storedCursor: held.get(liveKey),
      });
    } catch (error) {
      console.error(`live tip ${liveKey} failed; continuing`, error);
      return emptyPass(`${factory.id}:live`);
    }
  }
  // Sequential: parallel tip scans 429 the public RPC and both factories miss.
  for (const factory of [...priority, ...secondary]) {
    if (Date.now() > scanDeadline) break;
    out.push(await scanLive(factory));
  }

  return out;
}

/**
 * Drain parked `live-gap` cursors toward the live tip. Does not read or
 * write `tokens:<factory>:live` — the minute cron owns those.
 */
export async function indexLiveGaps(
  deadline: number,
  maxBlocks: bigint,
  extras: {
    skipImages?: boolean;
    writeCap?: number;
    writeConcurrency?: number;
    batchPauseMs?: number;
    heldCursors?: Map<string, bigint>;
    persistWrites?: (rows: TokenWrite[]) => Promise<void>;
  } = {},
): Promise<IndexPass[]> {
  const tip = await head();
  const liveFactories = liveFactoryList();
  const liveKeys = liveFactories.map((factory) => `tokens:${factory.id}:live`);
  const gapKeys = liveFactories.map((factory) => `tokens:${factory.id}:live-gap`);
  const held = await readCursors([...liveKeys, ...gapKeys], extras.heldCursors);
  const window = maxBlocks > 0n ? maxBlocks : 4_000n;
  const out: IndexPass[] = [];

  for (const factory of liveFactories) {
    if (Date.now() > deadline) break;
    const gapKey = `tokens:${factory.id}:live-gap`;
    const liveKey = `tokens:${factory.id}:live`;
    const gapStored = held.get(gapKey) ?? 0n;
    const liveStored = held.get(liveKey) ?? 0n;
    const until = liveStored > 0n ? liveStored : tip;
    if (gapStored === 0n || until <= gapStored + REORG) continue;
    console.warn(`live-gap ${gapKey} ${gapStored} -> ${until} window ${window}`);
    try {
      const pass = await indexFactory(factory, window, deadline, gapKey, {
        skipImages: extras.skipImages,
        writeCap: extras.writeCap,
        writeConcurrency: extras.writeConcurrency ?? 1,
        batchPauseMs: extras.batchPauseMs,
        storedCursor: gapStored,
        untilBlock: until,
        bondedOnly: true,
        writeTimeoutMs: 45_000,
        persistWrites: extras.persistWrites,
      });
      out.push(pass);
    } catch (error) {
      console.error(`live-gap ${gapKey} failed; continuing`, error);
      out.push(emptyPass(`${factory.id}:live-gap`));
    }
  }
  return out;
}

export async function indexTokens(
  maxBlocksOrOpts: bigint | IndexOptions = 8_000n,
): Promise<{
  passes: IndexPass[];
  stats: number;
  unresolvedRewards: string[];
  head: string;
}> {
  if (!hasDatabase) throw new Error("Supabase is not configured");
  const opts: IndexOptions =
    typeof maxBlocksOrOpts === "bigint" ? {maxBlocks: maxBlocksOrOpts} : maxBlocksOrOpts;
  const maxBlocks = opts.maxBlocks ?? 8_000n;
  const budgetMs = opts.budgetMs ?? BUDGET_MS;
  const deadline = budgetMs <= 0 ? Number.POSITIVE_INFINITY : Date.now() + budgetMs;
  const tip = await head();
  const passes: IndexPass[] = [];
  const unresolved = new Set<string>();

  if (opts.live !== false) {
    try {
      const live = await indexLiveTip(deadline, maxBlocks, {
        skipImages: opts.skipImages,
        writeCap: opts.writeCap,
        writeConcurrency: opts.writeConcurrency,
        batchPauseMs: opts.batchPauseMs,
        heldCursors: opts.heldCursors,
        persistWrites: opts.persistWrites,
        seenTokens: opts.seenTokens,
      });
      for (const pass of live) {
        passes.push(pass);
        for (const address of pass.unresolvedRewards) unresolved.add(address);
      }
    } catch (error) {
      console.error("live tip index failed; historical pass still runs", error);
      if (opts.historical === false && opts.drainGap !== true) throw error;
    }
  }

  if (opts.drainGap === true) {
    try {
      const gaps = await indexLiveGaps(deadline, maxBlocks, {
        skipImages: opts.skipImages,
        writeCap: opts.writeCap,
        writeConcurrency: opts.writeConcurrency,
        batchPauseMs: opts.batchPauseMs,
        heldCursors: opts.heldCursors,
        persistWrites: opts.persistWrites,
      });
      for (const pass of gaps) {
        passes.push(pass);
        for (const address of pass.unresolvedRewards) unresolved.add(address);
      }
    } catch (error) {
      console.error("live-gap index failed; continuing", error);
      if (opts.live === false && opts.historical === false) throw error;
    }
  }

  if (opts.historical === false) {
    return {passes, stats: 0, unresolvedRewards: [...unresolved], head: tip.toString()};
  }

  const factories = opts.factoryId
    ? ALL_FACTORIES.filter((factory) => factory.id === opts.factoryId)
    : ALL_FACTORIES;

  for (const factory of factories) {
    if (Date.now() > deadline) break;
    if (factory.id === "long-factory") {
      // Same txs as Airlock Create; no ABI we can prove. Cursor still advances
      // so a later generation can be added without rescanning from zero.
      const stored =
        (await readCursors([`tokens:${factory.id}`], undefined, opts.cursorTimeoutMs)).get(
          `tokens:${factory.id}`,
        ) ?? 0n;
      const start = stored > 0n ? stored : factory.deployedAtBlock;
      const end = start + maxBlocks > tip ? tip : start + maxBlocks;
      if (end !== stored) await writeCursor(`tokens:${factory.id}`, end);
      passes.push({
        factory: factory.id,
        from: start.toString(),
        to: end.toString(),
        cursorTo: end.toString(),
        upserts: 0,
        unresolvedRewards: [],
      });
      continue;
    }
    const pass = await indexFactory(factory, maxBlocks, deadline, `tokens:${factory.id}`, {
      skipImages: opts.skipImages,
      writeCap: opts.writeCap,
      writeConcurrency: opts.writeConcurrency,
      batchPauseMs: opts.batchPauseMs,
      cursorTimeoutMs: opts.cursorTimeoutMs,
    });
    passes.push(pass);
    for (const address of pass.unresolvedRewards) unresolved.add(address);
  }

  let stats = 0;
  if (opts.refreshStats !== false) {
    try {
      const leftover = deadline - Date.now();
      if (leftover > 8_000) {
        const pass = await refreshOnchainPrices({
          hotLimit: 40,
          unpricedLimit: 80,
          budgetMs: Math.min(leftover - 2_000, 20_000),
        });
        stats = pass.priced;
      }
    } catch (error) {
      console.error("token_stats refresh failed; tokens left untouched", error);
    }
  }

  return {passes, stats, unresolvedRewards: [...unresolved], head: tip.toString()};
}

async function attachResolvedPools(writes: TokenWrite[]) {
  const discovered = await discoverV3Pools(writes.map((row) => row.address));
  const poolRows: {token: string; pool: string; fee: number; quote: string; liquidity: bigint}[] = [];
  for (const write of writes) {
    const hits = discovered.get(normalizeAddress(write.address)) ?? [];
    for (const hit of hits) {
      poolRows.push({
        token: hit.token,
        pool: hit.pool,
        fee: hit.fee,
        quote: hit.quote,
        liquidity: hit.liquidity,
      });
    }
    const best = pickBestPool(hits);
    if (!best) continue;
    write.pool_address = best.pool;
    write.fee_tier = best.fee;
    write.pool_quote_token = best.quote;
    write.pool_liquidity = best.liquidity.toString();
  }
  return poolRows;
}

