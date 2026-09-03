import {parseAbi, parseAbiItem, type Abi} from "viem";
import {db, hasDatabase} from "../db";
import {multicallChunked} from "./chain";
import {RWA_BY_ADDRESS, RWA_REGISTRY} from "./robinhood";
import {cachedQuotes} from "./robinhood";

/**
 * Tokens that pay their holders in RWA stock tokens.
 *
 * A token qualifies when a contract associated with it has transferred a stock
 * token to at least ten distinct holders inside the window. The holder count is
 * what stops a project sending itself a dollar of NVDA to buy the badge.
 *
 * Runs against the public Robinhood RPC rather than Alchemy. The Alchemy plan
 * in use caps `eth_getLogs` at a ten-block range; the public endpoint allows
 * over a thousand and limits on result count instead, which an adaptive window
 * handles.
 */

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Distinct recipients before a sender counts as distributing rather than trading. */
const MIN_RECIPIENTS = 10;

/**
 * Rows written per pass.
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
 * How long a single pass may run.
 *
 * The scan is a cron job, not a request, but it still has to finish inside a
 * function timeout. Whatever it has walked when the budget runs out is written
 * and the cursor saved, so the next run picks up from there rather than
 * repeating work.
 */
const BUDGET_MS = 12_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
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
): Promise<{logs: RawLog[]; reached: bigint}> {
  const out: RawLog[] = [];
  const deadline = Date.now() + BUDGET_MS;
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
        // Not a sizing problem, or already as small as it is worth going.
        cursor = end + 1n;
        continue;
      }
      window /= 2n;
    }
  }

  // The cursor is where the walk actually got to, which is what gets stored —
  // claiming the whole range when the budget cut it short would skip blocks.
  return {logs: out, reached: cursor > toBlock ? toBlock : cursor - 1n};
}

export interface RewardScan {
  scanned: {from: string; to: string};
  distributions: number;
  tokens: number;
}

/**
 * One pass of the detector.
 *
 * Bounded by `maxBlocks` so a cron run has a predictable cost. Progress is
 * stored, so successive runs walk forward rather than rescanning.
 */
export async function scanRewards(maxBlocks = 300): Promise<RewardScan> {
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
  );

  // Group by sender: a distributor pays many distinct holders in one window,
  // where a trader pays a pool.
  const bySender = new Map<
    string,
    {recipients: Set<string>; rows: {token: string; to: string; value: bigint; tx: string; block: bigint}[]}
  >();

  for (const log of logs) {
    if (log.topics.length < 3) continue;
    const sender = addressFromTopic(log.topics[1]);
    const recipient = addressFromTopic(log.topics[2]);
    if (sender === "0x0000000000000000000000000000000000000000") continue;

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

  // Only prices already in memory. Fetching two hundred quotes inside the scan
  // was most of what made a pass take minutes, and a payout with no price is
  // still worth recording — `refreshRewardTotals` re-values it later.
  const quoteMap = cachedQuotes();
  const distributions: Record<string, unknown>[] = [];
  const tokensSeen = new Set<string>();

  const qualifyingSenders: string[] = [];
  for (const [sender, entry] of bySender) {
    if (entry.recipients.size < MIN_RECIPIENTS) continue;
    if (pools.has(sender)) continue;
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

  const senderToToken = new Map<string, string>();
  for (let i = 0; i < qualifyingSenders.length; i++) {
    const sender = qualifyingSenders[i]!;
    const entry = linkedTokens[i];
    if (entry?.status !== "success" || !entry.result) continue;
    const linked = String(entry.result).toLowerCase();
    if (linked && linked !== ZERO) senderToToken.set(sender, linked);
  }

  for (const [sender, entry] of bySender) {
    if (distributions.length >= MAX_ROWS) break;
    if (entry.recipients.size < MIN_RECIPIENTS) continue;
    if (pools.has(sender)) continue;

    const communityToken = senderToToken.get(sender);
    if (!communityToken) continue;

    for (const row of entry.rows) {
      const rwa = RWA_BY_ADDRESS.get(row.token);
      if (!rwa) continue;
      const price = quoteMap.get(rwa.ticker)?.priceUsd ?? 0;
      const amount = Number(row.value) / 1e18;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (distributions.length >= MAX_ROWS) break;
      tokensSeen.add(communityToken);
      distributions.push({
        token_address: communityToken,
        rwa_ticker: rwa.ticker,
        distributor: sender,
        amount,
        amount_usd: amount * price,
        tx_hash: row.tx,
        block_number: Number(row.block),
        occurred_at: new Date().toISOString(),
      });
    }
  }

  if (distributions.length > 0) {
    const {error} = await db()
      .from("reward_distributions")
      .upsert(distributions, {onConflict: "tx_hash", ignoreDuplicates: true});

    // Not swallowed. This write silently rejected every row for weeks —
    // `token_address` carries a foreign key to `tokens`, which nothing
    // populates, so each batch failed the constraint while the scan went on
    // reporting how many distributions it had "written".
    if (error) {
      throw new Error(
        `reward_distributions write failed (${error.code}): ${error.message}`,
      );
    }
  }

  await db()
    .from("indexer_state")
    .upsert({name: "rewards", last_block: Number(reached), updated_at: new Date().toISOString()});

  return {
    scanned: {from: from.toString(), to: reached.toString()},
    distributions: distributions.length,
    tokens: tokensSeen.size,
  };
}

/** Rolls the last day of proven payouts onto the tokens table. */
export async function refreshRewardTotals(): Promise<number> {
  if (!hasDatabase) return 0;

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const {data} = await db()
    .from("reward_distributions")
    .select("token_address, amount_usd")
    .gte("occurred_at", since);

  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.token_address).toLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + Number(row.amount_usd ?? 0));
  }

  for (const [address, total] of totals) {
    await db().from("tokens").update({rewards_24h_usd: total}).eq("address", address);
  }

  return totals.size;
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

  const wanted = new Set(addresses.map((a) => a.toLowerCase()));
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
    const address = String(row.address).toLowerCase();
    if (wanted.has(address)) paying.add(address);
  }
  for (const row of dists ?? []) {
    const address = String(row.token_address).toLowerCase();
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
    paying.add(String(row.address).toLowerCase());
  }
  for (const row of dists ?? []) {
    paying.add(String(row.token_address).toLowerCase());
  }

  return paying;
}
