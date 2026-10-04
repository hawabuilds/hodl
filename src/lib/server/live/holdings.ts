import type {Holding} from "@/lib/types";
import {normalizeAddress, isAddress} from "@/lib/address";
import {feedImageUrl} from "@/lib/tokenImage";
import {RH_MAINNET_ID} from "@/config/chain";
import {QUOTE_USDG} from "@/lib/contracts";
import {erc20Abi} from "viem";
import {db, hasDatabase} from "../db";
import {cached, cachedLocal, keepAlive} from "./cache";
import {nativeBalance, rpc, walletSnapshot} from "./chain";
import {readShared, writeShared} from "./shared";
import {RWA_BY_ADDRESS, RWA_REGISTRY, rwaPricesFor, type RwaPrice} from "./robinhood";
import {getTokenRows, statsFor, type TokenRow} from "./universeStore";

const USDG_DECIMALS = 6;

export interface PortfolioTiming {
  discoverMs: number;
  rpcMs: number;
  supabaseMs: number;
  totalMs: number;
  candidates: number;
  rpcCalls: number;
}

export interface HoldingsResult {
  holdings: Holding[];
  ethBalance: number;
  /** USDG, held as cash beside ETH: never a token holding, always $1. */
  usdgBalance: number;
  degraded: boolean;
  wallets: string[];
  chainId: number;
  timing: PortfolioTiming;
}

function walletsOf(raw: string[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const address = normalizeAddress(value);
    if (isAddress(address) && !out.includes(address)) out.push(address);
  }
  return out;
}

/** Union of address lists, lowercase, first-seen order. */
export function mergeCandidates(...groups: Iterable<string>[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      const address = normalizeAddress(value);
      if (!isAddress(address) || seen.has(address)) continue;
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

interface TransferRow {
  rawContract?: {address?: string};
  rawContractAddress?: string;
}

async function alchemyTransfers(wallet: string, side: "from" | "to"): Promise<string[]> {
  const url = process.env.ALCHEMY_RPC_URL;
  if (!url) return [];
  const filter: Record<string, unknown> = {
    category: ["erc20"],
    excludeZeroValue: true,
    maxCount: "0x3e8",
    withMetadata: false,
  };
  if (side === "from") filter.fromAddress = wallet;
  else filter.toAddress = wallet;

  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [filter],
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    result?: {transfers?: TransferRow[]};
    error?: {message: string};
  };
  if (body.error) return [];
  const out: string[] = [];
  for (const row of body.result?.transfers ?? []) {
    const address = row.rawContract?.address ?? row.rawContractAddress;
    if (address) out.push(address);
  }
  return out;
}

async function touchedTokens(wallet: string): Promise<string[]> {
  const [sent, received] = await Promise.all([
    alchemyTransfers(wallet, "from"),
    alchemyTransfers(wallet, "to"),
  ]);
  return mergeCandidates(sent, received);
}

/**
 * Tokens whose price moved in the last 90 days — every token that can have
 * been bought here recently, since a buy moves its price. (All 37k listed
 * tokens took 14s to list; this set is ~23k and 2s.) Kept in this server's
 * memory for half an hour: at ~1MB it is too big to pass through Redis.
 */
const SWEEP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function sweepAddresses(): Promise<string[]> {
  return cachedLocal("portfolio:sweep-addresses", 30 * 60_000, async () => {
    if (!hasDatabase) return [];
    const since = new Date(Date.now() - SWEEP_WINDOW_MS).toISOString();
    const out: string[] = [];
    for (let from = 0; from < 100_000; from += 1_000) {
      const {data, error} = await db()
        .from("token_stats")
        .select("address")
        .gte("price_moved_at", since)
        .order("address")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as {address: string}[]) out.push(normalizeAddress(row.address));
      if (!data || data.length < 1_000) break;
    }
    return out;
  });
}

/**
 * Which recently active tokens this wallet holds, by asking the chain for its
 * balance of every one — in a few large multicalls, not one call per token — so a
 * token shows whether it was bought here, elsewhere, or sent in. Without an
 * indexer (Alchemy's transfer history is not set up for this chain) this is
 * the only way to find a token the wallet has not traded through HODL.
 * Kept five minutes per wallet; a trade made here refreshes it at once
 * through the client's hint and the saved trade.
 */
export function sweepListed(wallet: string): Promise<string[]> {
  return cached(
    `portfolio:sweep:${wallet}`,
    5 * 60_000,
    async () => {
      const universe = await sweepAddresses();
      if (universe.length === 0) return [];
      const owner = wallet as `0x${string}`;
      const results = await rpc().multicall({
        contracts: universe.map((address) => ({
          address: address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [owner] as const,
        })),
        allowFailure: true,
        // ~300 balance reads per call: a few calls for the whole set.
        batchSize: 48_000,
      });
      return universe.filter((_, i) => {
        const result = results[i];
        return result?.status === "success" && typeof result.result === "bigint" && result.result > 0n;
      });
    },
    {sharedTtlSeconds: 5 * 60},
  );
}

/** Tokens these wallets bought or sold through HODL (saved trades). */
async function tradedTokens(wallets: string[]): Promise<string[]> {
  if (!hasDatabase || wallets.length === 0) return [];
  const {data} = await db()
    .from("hodl_trades")
    .select("asset_id")
    .eq("kind", "token")
    .in("wallet", wallets)
    .limit(500);
  return ((data ?? []) as {asset_id: string}[]).map((row) => row.asset_id);
}

const heldKey = (wallet: string) => `portfolio:held:${wallet}`;
/** The stocks a wallet held last time, so their prices load beside the balances. */
const heldRwaKey = (wallet: string) => `portfolio:held-rwa:${wallet}`;
/**
 * How long the portfolio waits on the full balance sweep before answering: the
 * first time a wallet is seen. After that what it held last time is known, so
 * the sweep only gets a moment and finishes in the background for next time.
 */
const SWEEP_PATIENCE_MS = 2_500;
const SWEEP_PATIENCE_KNOWN_MS = 300;

function rwaAddresses(): string[] {
  return RWA_REGISTRY.map((entry) => normalizeAddress(entry.address));
}

/**
 * What the wallets actually hold.
 *
 * Candidates are tokens this wallet has touched, the RWA registry, and
 * addresses the client already knows it holds. Never the whole universe —
 * and never filtered on eligible / is_tradeable / status.
 */
export async function holdingsFor(
  walletOrWallets: string | string[],
  known: string[] = [],
): Promise<HoldingsResult> {
  const started = Date.now();
  const emptyTiming = (): PortfolioTiming => ({
    discoverMs: 0,
    rpcMs: 0,
    supabaseMs: 0,
    totalMs: Date.now() - started,
    candidates: 0,
    rpcCalls: 0,
  });

  const wallets = walletsOf(
    Array.isArray(walletOrWallets) ? walletOrWallets : [walletOrWallets],
  );
  if (wallets.length === 0) {
    return {
      holdings: [],
      ethBalance: 0,
      usdgBalance: 0,
      degraded: false,
      wallets: [],
      chainId: RH_MAINNET_ID,
      timing: emptyTiming(),
    };
  }

  const discoverStarted = Date.now();
  // Where a held token can be found: transfer history (when Alchemy is set
  // up), saved HODL trades, what these wallets held last time, the client's
  // own hint, the RWAs — and a balance sweep of every listed token, waited on
  // for at most SWEEP_PATIENCE_MS (it carries on and is cached for next time).
  const sweeping = Promise.all(wallets.map((wallet) => sweepListed(wallet).catch(() => [] as string[])));
  keepAlive(sweeping);
  const rememberedRead = Promise.all(
    wallets.map((wallet) => readShared<string[]>(heldKey(wallet)).catch(() => null)),
  );
  // The stocks held last time start pricing now, beside the balance read.
  const rwaPricesEarly = Promise.all(
    wallets.map((wallet) => readShared<string[]>(heldRwaKey(wallet)).catch(() => null)),
  ).then((lists) => rwaPricesFor(lists.flatMap((list) => list ?? [])));
  const [touched, traded, remembered, swept] = await Promise.all([
    Promise.all(wallets.map((wallet) => touchedTokens(wallet).catch(() => [] as string[]))),
    tradedTokens(wallets).catch(() => [] as string[]),
    rememberedRead,
    rememberedRead.then((lists) =>
      Promise.race([
        sweeping,
        new Promise<string[][]>((resolve) =>
          setTimeout(
            () => resolve([]),
            lists.every((list) => list != null) ? SWEEP_PATIENCE_KNOWN_MS : SWEEP_PATIENCE_MS,
          ),
        ),
      ]),
    ),
  ]);
  const candidates = mergeCandidates(
    rwaAddresses(),
    known,
    traded,
    ...touched,
    ...remembered.map((list) => list ?? []),
    ...swept,
  );
  const discoverMs = Date.now() - discoverStarted;

  const wanted = candidates
    .filter((address) => address !== QUOTE_USDG)
    .map((address) => ({
      address,
      decimals: RWA_BY_ADDRESS.get(address)?.decimals ?? 18,
    }));
  // USDG rides in the same balance read; it is cash, split out below.
  wanted.push({address: QUOTE_USDG, decimals: USDG_DECIMALS});

  // Names and prices for every candidate token load beside the balance read
  // rather than after it: the held tokens are among the candidates.
  const tokenCandidates = candidates.filter((address) => !RWA_BY_ADDRESS.has(address));
  let statsFailed = false;
  const enrichEarly = Promise.all([
    hasDatabase && tokenCandidates.length > 0
      ? getTokenRows(tokenCandidates).catch(() => [] as TokenRow[])
      : Promise.resolve([] as TokenRow[]),
    tokenCandidates.length > 0
      ? statsFor(tokenCandidates).catch(() => {
          statsFailed = true;
          return new Map() as Awaited<ReturnType<typeof statsFor>>;
        })
      : Promise.resolve(new Map() as Awaited<ReturnType<typeof statsFor>>),
  ]);

  const rpcStarted = Date.now();
  const merged = new Map<string, number>();
  let eth = 0;
  let rpcCalls = 0;
  let degraded = false;

  try {
    const reads = await Promise.all(
      wallets.map((wallet) => walletSnapshot(wallet, wanted)),
    );
    for (const read of reads) {
      eth += read.eth;
      rpcCalls += read.rpcCalls;
      for (const [address, amount] of read.amounts) {
        merged.set(address, (merged.get(address) ?? 0) + amount);
      }
    }
  } catch (error) {
    console.error("balance read failed", error);
    degraded = true;
  }
  const rpcMs = Date.now() - rpcStarted;
  const usdgBalance = merged.get(QUOTE_USDG) ?? 0;
  merged.delete(QUOTE_USDG);

  const held = [...merged.entries()].filter(([, amount]) => amount > 0);
  const heldAddresses = held.map(([address]) => address);
  // Next time these are candidates straight away, before any sweep.
  const heldTickers = heldAddresses.flatMap((address) => {
    const rwa = RWA_BY_ADDRESS.get(address);
    return rwa ? [rwa.ticker.toUpperCase()] : [];
  });
  if (!degraded) {
    const tokens = heldAddresses.filter((address) => !RWA_BY_ADDRESS.has(address));
    for (const wallet of wallets) {
      void writeShared(heldKey(wallet), tokens, 30 * 24 * 60 * 60).catch(() => {});
      void writeShared(heldRwaKey(wallet), heldTickers, 30 * 24 * 60 * 60).catch(() => {});
    }
  }

  const enrichStarted = Date.now();
  const [[rows, stats], early] = await Promise.all([
    enrichEarly,
    rwaPricesEarly.catch(() => new Map<string, RwaPrice>()),
  ]);
  // A stock held now that was not held last time is priced here.
  const late = heldTickers.filter((ticker) => !early.has(ticker));
  const rwaPrices =
    late.length > 0 ? new Map([...early, ...(await rwaPricesFor(late).catch(() => new Map()))]) : early;
  const byRow = new Map(rows.map((row) => [normalizeAddress(row.address), row]));
  const supabaseMs = Date.now() - enrichStarted;

  const holdings: Holding[] = [];
  for (const [address, amount] of held) {
    const row = byRow.get(address);
    const rwa = RWA_BY_ADDRESS.get(address);
    const stat = stats.get(address);
    if (rwa) {
      // No price is not a price of zero: the holding waits for one instead.
      const price = rwaPrices.get(rwa.ticker.toUpperCase());
      holdings.push({
        kind: "rwa",
        assetId: rwa.ticker.toLowerCase(),
        symbol: rwa.ticker,
        name: rwa.name,
        logoUrl: rwa.logoUrl,
        amount,
        valueUsd: price ? amount * price.priceUsd : 0,
        changePct: 0,
        costUsd: null,
        priceUsd: price?.priceUsd ?? null,
        priceState: !price ? "pending" : price.stale ? "stale" : "live",
        priceAt: price?.stale ? new Date(price.at).toISOString() : null,
      });
      continue;
    }
    const priceUsd =
      stat?.last_price != null && Number(stat.last_price) > 0
        ? Number(stat.last_price)
        : null;
    holdings.push({
      kind: "token",
      assetId: address,
      symbol: row?.symbol ?? "???",
      name: row?.name ?? row?.symbol ?? "Unknown",
      logoUrl: row ? feedImageUrl(row) : null,
      amount,
      valueUsd: priceUsd != null ? amount * priceUsd : 0,
      changePct: Number(stat?.price_change_24h ?? 0),
      costUsd: null,
      pairedTicker: pairedTickerOf(row),
      priceUsd,
      // A failed price read is pending; a token that simply has no market
      // price is "none", which is a fact rather than a gap.
      priceState: priceUsd != null ? "live" : statsFailed ? "pending" : "none",
    });
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return {
    holdings,
    ethBalance: eth,
    usdgBalance,
    degraded,
    wallets,
    chainId: RH_MAINNET_ID,
    timing: {
      discoverMs,
      rpcMs,
      supabaseMs,
      totalMs: Date.now() - started,
      candidates: candidates.length,
      rpcCalls,
    },
  };
}

/** The ticker on the other side of a token's pool, as the feeds show it. */
function pairedTickerOf(row: TokenRow | undefined): string | null {
  if (!row) return null;
  if (row.quote_kind === "rwa") {
    return RWA_BY_ADDRESS.get(normalizeAddress(row.quote_token ?? ""))?.ticker ?? row.reward_rwa ?? null;
  }
  if (row.quote_kind === "usdg") return "USDG";
  if (row.quote_kind === "eth") return "WETH";
  return null;
}

async function usdgBalanceOf(wallet: string): Promise<number> {
  const raw = await rpc().readContract({
    address: QUOTE_USDG,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet as `0x${string}`],
  });
  return Number(raw) / 10 ** USDG_DECIMALS;
}

export async function nativeOnly(
  walletOrWallets: string | string[],
): Promise<{ethBalance: number; usdgBalance: number; wallets: string[]; chainId: number; rpcCalls: number; totalMs: number}> {
  const started = Date.now();
  const wallets = walletsOf(
    Array.isArray(walletOrWallets) ? walletOrWallets : [walletOrWallets],
  );
  if (wallets.length === 0) {
    return {ethBalance: 0, usdgBalance: 0, wallets: [], chainId: RH_MAINNET_ID, rpcCalls: 0, totalMs: 0};
  }
  const [reads, usdg] = await Promise.all([
    Promise.all(wallets.map((wallet) => nativeBalance(wallet).catch(() => 0))),
    Promise.all(wallets.map((wallet) => usdgBalanceOf(wallet).catch(() => 0))),
  ]);
  return {
    ethBalance: reads.reduce((sum, value) => sum + value, 0),
    usdgBalance: usdg.reduce((sum, value) => sum + value, 0),
    wallets,
    chainId: RH_MAINNET_ID,
    rpcCalls: wallets.length * 2,
    totalMs: Date.now() - started,
  };
}

