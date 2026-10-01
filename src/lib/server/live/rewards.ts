import {parseAbi, type Abi} from "viem";
import {normalizeAddress, normalizeAddresses} from "@/lib/address";
import {db, hasDatabase} from "../db";
import {multicallChunked} from "./chain";
import {cachedQuotes, RWA_BY_ADDRESS, RWA_REGISTRY} from "./robinhood";

/**
 * Tokens that pay their holders in RWA stock tokens.
 *
 * A token qualifies when a contract associated with it has transferred a stock
 * token to at least ten distinct holders inside the window. The holder count is
 * what stops a project sending itself a dollar of NVDA to buy the badge.
 *
 * Amounts are aggregated per payout transaction, timed from the block range,
 * and rolled onto `tokens.rewards_24h_usd` so Home Rewards and New
 * `?rewards=rwa` can rank on dollars rather than a routing flag.
 *
 * Runs against the public Robinhood RPC rather than Alchemy. The Alchemy plan
 * in use caps `eth_getLogs` at a ten-block range; the public endpoint allows
 * over a thousand and limits on result count instead, which an adaptive window
 * handles.
 */

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Distinct recipients before a sender counts as distributing rather than trading. */
export const MIN_RECIPIENTS = 10;

/**
 * Payout transactions written per pass.
 *
 * Stock tokens transfer constantly, so an unbounded run once wrote for
 * twenty-four minutes. The cap keeps a pass predictable; the cursor means the
 * next one continues rather than repeating.
 */
const MAX_ROWS = 500;

/** Starting window. Halves on a result-cap rejection, grows back on success. */
const START_WINDOW = 800n;
const MIN_WINDOW = 50n;

/**
 * How long the log walk may run inside a Vercel cron (maxDuration 60s).
 * Refresh writes use whatever is left, so this stays under the function limit.
 */
export const SCAN_BUDGET_MS = 40_000;

/** Default chain span per pass. Cursor resumes; a short 300-block hour never caught 24h. */
export const SCAN_MAX_BLOCKS = 4_000;

/** Tokens table writes per refresh — live-gap and prices may be running too. */
export const MAX_TOKEN_WRITES = 24;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

const topic0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const distributorAbi = parseAbi(["function token() view returns (address)"]);

const ZERO = "0x0000000000000000000000000000000000000000";

const addressFromTopic = (topic: string) => "0x" + topic.slice(26).toLowerCase();

export function showsRewards24h(usd: number | null | undefined): boolean {
  return Number(usd ?? 0) > 0;
}

export function roundRewardUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

/** Block time from the scanned endpoints — two RPCs, not one per log. */
export function interpolateOccurredAt(
  block: bigint,
  from: bigint,
  to: bigint,
  fromMs: number,
  toMs: number,
): string {
  if (!(fromMs > 0)) return new Date().toISOString();
  if (to <= from || toMs <= fromMs) return new Date(fromMs).toISOString();
  const span = Number(to - from);
  const offset = Number(block - from);
  const ms = fromMs + (offset / span) * (toMs - fromMs);
  return new Date(ms).toISOString();
}

export interface TransferRow {
  token: string;
  to: string;
  value: bigint;
  tx: string;
  block: bigint;
}

export interface QualifiedSender {
  sender: string;
  communityToken: string;
  rows: TransferRow[];
}

export interface PayoutRow {
  token_address: string;
  rwa_ticker: string;
  distributor: string;
  amount: number;
  amount_usd: number;
  tx_hash: string;
  block_number: number;
  occurred_at: string;
}

export function senderQualifies(recipientCount: number, isPool: boolean): boolean {
  return recipientCount >= MIN_RECIPIENTS && !isPool;
}

/**
 * One row per payout transaction. `reward_distributions.tx_hash` is unique, so
 * per-transfer inserts used to keep only the first hop and drop the rest of
 * the amount.
 */
export function aggregatePayouts(
  senders: QualifiedSender[],
  quotes: Map<string, {priceUsd: number}>,
  occurredAt: (block: bigint) => string,
  maxRows = MAX_ROWS,
): PayoutRow[] {
  const byTx = new Map<string, PayoutRow>();

  for (const sender of senders) {
    for (const row of sender.rows) {
      const rwa = RWA_BY_ADDRESS.get(row.token);
      if (!rwa) continue;
      const amount = Number(row.value) / 1e18;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const price = quotes.get(rwa.ticker)?.priceUsd ?? 0;
      const held = byTx.get(row.tx);
      if (held) {
        held.amount += amount;
        held.amount_usd += amount * price;
        if (row.block < BigInt(held.block_number)) {
          held.block_number = Number(row.block);
          held.occurred_at = occurredAt(row.block);
        }
      } else {
        if (byTx.size >= maxRows) return [...byTx.values()];
        byTx.set(row.tx, {
          token_address: sender.communityToken,
          rwa_ticker: rwa.ticker,
          distributor: sender.sender,
          amount,
          amount_usd: amount * price,
          tx_hash: row.tx,
          block_number: Number(row.block),
          occurred_at: occurredAt(row.block),
        });
      }
    }
  }

  return [...byTx.values()];
}

export function totalsByToken(
  rows: {token_address: string; amount: number; amount_usd: number; rwa_ticker: string}[],
  prices: Map<string, number>,
): {totals: Map<string, number>; unpriced: Set<string>} {
  const totals = new Map<string, number>();
  const unpriced = new Set<string>();

  for (const row of rows) {
    const key = normalizeAddress(String(row.token_address));
    const stored = Number(row.amount_usd);
    const fallback = Number(row.amount) * (prices.get(row.rwa_ticker) ?? 0);
    const usd = stored > 0 ? stored : fallback;
    if (usd > 0) {
      totals.set(key, (totals.get(key) ?? 0) + usd);
    } else {
      unpriced.add(key);
    }
  }

  for (const address of totals.keys()) unpriced.delete(address);
  return {totals, unpriced};
}

/**
 * Desired `rewards_24h_usd` including zeros for expired windows.
 * Tokens that paid but have no USD quote yet keep their current figure.
 */
export function mergeRewardTargets(
  desired: Map<string, number>,
  current: Map<string, number>,
  unpriced: Set<string>,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [address, total] of desired) {
    next.set(address, roundRewardUsd(total));
  }
  for (const address of current.keys()) {
    if (next.has(address) || unpriced.has(address)) continue;
    next.set(address, 0);
  }
  return next;
}

/** Only the rows whose persisted total actually moved, largest first. */
export function rewardTotalWrites(
  desired: Map<string, number>,
  current: Map<string, number>,
  cap = MAX_TOKEN_WRITES,
): {address: string; rewards_24h_usd: number}[] {
  const diffs: {address: string; rewards_24h_usd: number; delta: number}[] = [];
  const keys = new Set([...desired.keys(), ...current.keys()]);
  for (const address of keys) {
    const next = roundRewardUsd(desired.get(address) ?? 0);
    const prev = roundRewardUsd(current.get(address) ?? 0);
    if (next === prev) continue;
    diffs.push({address, rewards_24h_usd: next, delta: Math.abs(next - prev)});
  }
  diffs.sort((a, b) => b.delta - a.delta);
  return diffs.slice(0, cap).map(({address, rewards_24h_usd}) => ({
    address,
    rewards_24h_usd,
  }));
}

/**
 * Stock-token transfers over a block range, walked in adaptive windows.
 *
 * The public endpoint rejects a query whose results exceed its cap rather than
 * one whose range is too wide, so the window shrinks on rejection and widens
 * again once it fits. That keeps the scan close to the largest range the node
 * will actually serve instead of guessing a small constant.
 */
async function transfersBetween(
  fromBlock: bigint,
  toBlock: bigint,
  addresses: string[],
  budgetMs: number,
): Promise<{logs: RawLog[]; reached: bigint}> {
  const out: RawLog[] = [];
  const deadline = Date.now() + budgetMs;
  let window = START_WINDOW;
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    if (Date.now() > deadline) break;
    const end = cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n;
    try {
      const logs = await rpc<RawLog[]>("eth_getLogs", [
        {
          fromBlock: "0x" + cursor.toString(16),
          toBlock: "0x" + end.toString(16),
          address: addresses,
          topics: [topic0],
        },
      ]);
      out.push(...logs);
      cursor = end + 1n;
      if (window < START_WINDOW) window *= 2n;
    } catch (error) {
      const capped = /exceeds|limit|too many|range/i.test(String(error));
      if (!capped || window <= MIN_WINDOW) {
        cursor = end + 1n;
        continue;
      }
      window /= 2n;
    }
  }

  return {logs: out, reached: cursor > toBlock ? toBlock : cursor - 1n};
}

async function blockTimestampMs(block: bigint): Promise<number | null> {
  try {
    const raw = await rpc<{timestamp: string}>("eth_getBlockByNumber", [
      "0x" + block.toString(16),
      false,
    ]);
    const ms = parseInt(raw.timestamp, 16) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

async function quotePricesFor(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cached = cachedQuotes();
  const missing: string[] = [];
  for (const ticker of [...new Set(tickers)]) {
    const price = cached.get(ticker)?.priceUsd;
    if (price && price > 0) out.set(ticker, price);
    else missing.push(ticker);
  }

  const deadline = Date.now() + 4_000;
  for (const ticker of missing.slice(0, 8)) {
    if (Date.now() > deadline) break;
    try {
      const res = await fetch(
        `https://api.robinhood.com/rhj/prices/${encodeURIComponent(ticker)}`,
        {cache: "no-store", signal: AbortSignal.timeout(8_000)},
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        quotes?: {bid?: string; ask?: string}[];
      };
      const q = body.quotes?.[0];
      const bid = Number(q?.bid);
      const ask = Number(q?.ask);
      const mid = (bid + ask) / 2;
      if (Number.isFinite(mid) && mid > 0) out.set(ticker, mid);
    } catch {
      // keep the stored amount_usd if we already have one
    }
  }
  return out;
}

export interface RewardScan {
  scanned: {from: string; to: string};
  distributions: number;
  tokens: number;
}

/**
 * One pass of the detector.
 *
 * Bounded so a cron run finishes inside Vercel 60s. Progress is stored, so
 * successive runs walk forward rather than rescanning.
 */
export async function scanRewards(
  maxBlocks = SCAN_MAX_BLOCKS,
  budgetMs = SCAN_BUDGET_MS,
): Promise<RewardScan> {
  if (!hasDatabase) throw new Error("Supabase is not configured");

  const head = BigInt(await rpc<string>("eth_blockNumber", []));

  const {data: state} = await db()
    .from("indexer_state")
    .select("last_block")
    .eq("name", "rewards")
    .maybeSingle();

  const from = state?.last_block
    ? BigInt(state.last_block) + 1n
    : head - BigInt(maxBlocks);
  const to = from + BigInt(maxBlocks) > head ? head : from + BigInt(maxBlocks);

  if (to <= from) {
    return {scanned: {from: from.toString(), to: from.toString()}, distributions: 0, tokens: 0};
  }

  const {logs, reached} = await transfersBetween(
    from,
    to,
    RWA_REGISTRY.map((entry) => entry.address),
    budgetMs,
  );

  const [fromMs, reachedMs] = await Promise.all([
    blockTimestampMs(from),
    blockTimestampMs(reached),
  ]);
  const occurredAt = (block: bigint) =>
    interpolateOccurredAt(
      block,
      from,
      reached,
      fromMs ?? Date.now(),
      reachedMs ?? Date.now(),
    );

  const bySender = new Map<
    string,
    {recipients: Set<string>; rows: TransferRow[]}
  >();

  for (const log of logs) {
    if (log.topics.length < 3) continue;
    const sender = addressFromTopic(log.topics[1]);
    const recipient = addressFromTopic(log.topics[2]);
    if (sender === ZERO) continue;

    const entry = bySender.get(sender) ?? {recipients: new Set(), rows: []};
    entry.recipients.add(recipient);
    entry.rows.push({
      token: log.address.toLowerCase(),
      to: recipient,
      value: BigInt(log.data === "0x" ? "0x0" : log.data),
      tx: log.transactionHash,
      block: BigInt(log.blockNumber),
    });
    bySender.set(sender, entry);
  }

  const pools = new Set<string>();
  const {data: knownPools} = await db().from("pools").select("address");
  for (const row of knownPools ?? []) pools.add(String(row.address).toLowerCase());

  const quoteMap = cachedQuotes();
  const qualifyingSenders: string[] = [];
  for (const [sender, entry] of bySender) {
    if (!senderQualifies(entry.recipients.size, pools.has(sender))) continue;
    qualifyingSenders.push(sender);
  }

  const linkedTokens = await multicallChunked<string>(
    qualifyingSenders.map((address) => ({
      address: address as `0x${string}`,
      abi: distributorAbi as Abi,
      functionName: "token",
    })),
    "rewards/token",
  );

  const senders: QualifiedSender[] = [];
  for (let i = 0; i < qualifyingSenders.length; i++) {
    const sender = qualifyingSenders[i]!;
    const entry = linkedTokens[i];
    if (entry?.status !== "success" || !entry.result) continue;
    const linked = String(entry.result).toLowerCase();
    if (!linked || linked === ZERO) continue;
    const held = bySender.get(sender);
    if (!held) continue;
    senders.push({sender, communityToken: linked, rows: held.rows});
  }

  const distributions = aggregatePayouts(senders, quoteMap, occurredAt);
  const tokensSeen = new Set(distributions.map((row) => row.token_address));

  let wrote = 0;
  if (distributions.length > 0) {
    const wanted = normalizeAddresses([
      ...new Set(distributions.map((row) => String(row.token_address))),
    ]);
    const {data: known} = await db().from("tokens").select("address").in("address", wanted);
    const exist = new Set((known ?? []).map((row) => normalizeAddress(String(row.address))));
    const accepted = distributions.filter((row) =>
      exist.has(normalizeAddress(String(row.token_address))),
    );
    wrote = accepted.length;
    if (accepted.length > 0) {
      const {error} = await db()
        .from("reward_distributions")
        .upsert(accepted, {onConflict: "tx_hash"});

      if (error) {
        throw new Error(
          `reward_distributions write failed (${error.code}): ${error.message}`,
        );
      }
    }
  }

  await db()
    .from("indexer_state")
    .upsert({name: "rewards", last_block: Number(reached), updated_at: new Date().toISOString()});

  return {
    scanned: {from: from.toString(), to: reached.toString()},
    distributions: wrote,
    tokens: tokensSeen.size,
  };
}

export interface RewardRefresh {
  tokensUpdated: number;
  remaining: number;
}

/** Rolls the last day of proven payouts onto the tokens table. */
export async function refreshRewardTotals(
  writeCap = MAX_TOKEN_WRITES,
): Promise<RewardRefresh> {
  if (!hasDatabase) return {tokensUpdated: 0, remaining: 0};

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const {data} = await db()
    .from("reward_distributions")
    .select("token_address, rwa_ticker, amount, amount_usd")
    .gte("occurred_at", since)
    .limit(2_000);

  const rows = (data ?? []).map((row) => ({
    token_address: String(row.token_address),
    rwa_ticker: String(row.rwa_ticker ?? ""),
    amount: Number(row.amount ?? 0),
    amount_usd: Number(row.amount_usd ?? 0),
  }));

  const prices = await quotePricesFor(rows.map((row) => row.rwa_ticker).filter(Boolean));
  const {totals, unpriced} = totalsByToken(rows, prices);

  const {data: currentRows} = await db()
    .from("tokens")
    .select("address, rewards_24h_usd")
    .gt("rewards_24h_usd", 0);

  const current = new Map<string, number>();
  for (const row of currentRows ?? []) {
    current.set(normalizeAddress(String(row.address)), Number(row.rewards_24h_usd ?? 0));
  }

  const desired = mergeRewardTargets(totals, current, unpriced);
  const writes = rewardTotalWrites(desired, current, writeCap);
  const pending =
    [...new Set([...desired.keys(), ...current.keys()])].filter((address) => {
      const next = roundRewardUsd(desired.get(address) ?? 0);
      const prev = roundRewardUsd(current.get(address) ?? 0);
      return next !== prev;
    }).length;

  for (const row of writes) {
    const {error} = await db()
      .from("tokens")
      .update({rewards_24h_usd: row.rewards_24h_usd})
      .eq("address", row.address);
    if (error) {
      throw new Error(`tokens.rewards_24h_usd write failed (${error.code}): ${error.message}`);
    }
  }

  return {tokensUpdated: writes.length, remaining: Math.max(0, pending - writes.length)};
}

/**
 * Tokens that pay holders in RWA stock tokens, from the rewards indexer.
 *
 * Returns null when Supabase is not configured — callers fall back to
 * `rewardsToHolders` (fee distributor routing) so the New tab is not empty
 * before the cron warms.
 */
export async function rewardsFromDb(
  addresses: string[],
): Promise<Set<string> | null> {
  if (!hasDatabase || addresses.length === 0) return null;

  const wanted = new Set(normalizeAddresses(addresses));
  const paying = new Set<string>();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{data: tokens}, {data: dists}] = await Promise.all([
    db()
      .from("tokens")
      .select("address")
      .in("address", [...wanted])
      .gt("rewards_24h_usd", 0),
    db()
      .from("reward_distributions")
      .select("token_address")
      .in("token_address", [...wanted])
      .gte("occurred_at", since),
  ]);

  for (const row of tokens ?? []) {
    const address = normalizeAddress(String(row.address));
    if (wanted.has(address)) paying.add(address);
  }
  for (const row of dists ?? []) {
    const address = normalizeAddress(String(row.token_address));
    if (wanted.has(address)) paying.add(address);
  }

  return paying;
}

/** Every community token the rewards indexer has proven pays in RWA stock. */
export async function allRewardPayingAddresses(): Promise<Set<string>> {
  if (!hasDatabase) return new Set();

  const paying = new Set<string>();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{data: tokens}, {data: dists}] = await Promise.all([
    db().from("tokens").select("address").gt("rewards_24h_usd", 0),
    db()
      .from("reward_distributions")
      .select("token_address")
      .gte("occurred_at", since),
  ]);

  for (const row of tokens ?? []) {
    paying.add(normalizeAddress(String(row.address)));
  }
  for (const row of dists ?? []) {
    paying.add(normalizeAddress(String(row.token_address)));
  }

  return paying;
}
