import {
  decodeAbiParameters,
  parseAbiParameters,
  toEventSelector,
} from "viem";
import type {Trade} from "@/lib/types";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";
import {cachedLocal} from "./cache";
import {recordCalls} from "./rpcMeter";
import {httpRpcUrls} from "./rpcProviders";
import {QUOTE_ASSETS} from "./dexscreener";
import {RWA_BY_ADDRESS} from "./robinhood";

/**
 * The last few seconds of fills, read straight off the chain.
 *
 * The indexer the tape is otherwise built from is roughly eleven seconds behind
 * the block — measured over two hundred and thirty fills, median 11s, worst
 * 23s. That is the floor however fast the app polls it, and it is what made new
 * buys and sells feel late.
 *
 * Reading the pool's own `Swap` logs closes almost all of it: the same fills
 * are available about half a second after the block. So the tape is assembled
 * from both — this for the head, the indexer for depth and history — which also
 * means a failure here costs freshness rather than the whole panel.
 *
 * Sides were checked against the indexer before this was trusted: seven of
 * seven on v3, fifty of fifty on v4. The two versions sign their amounts
 * oppositely, which is the one detail here worth getting right.
 */

/** Uniswap v3-style pools, which emit from the pool contract itself. */
const V3_SWAP = toEventSelector(
  "Swap(address,address,int256,int256,uint160,uint128,int24)",
);

/** Uniswap v4, where every pool emits from the singleton, keyed by pool id. */
const V4_SWAP = toEventSelector(
  "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
);

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

/**
 * How far back each read looks, in time.
 *
 * This was nine blocks, sized for "roughly a second a block". Robinhood Chain
 * makes a block about every 100ms, so nine blocks was under a second of
 * history against a two-second poll, and about half of all fills fell between
 * reads. The window is now set in time and turned into blocks from the chain's
 * measured block time, so it stays right if the block time changes.
 */
export const TAPE_WINDOW_MS = 4_000;

/** Robinhood Chain's measured block time, used until the first estimate lands. */
const DEFAULT_BLOCK_MS = 100;
/**
 * Blocks sampled to estimate block time, and how long an estimate stands.
 *
 * Kept recent on purpose: the Chainstack plan treats anything much past the
 * last ~128 blocks (about 13 seconds here) as an archive request and refuses
 * it. A hundred blocks is ten seconds, enough at second-resolution timestamps.
 */
const BLOCK_SAMPLE = 100n;
const BLOCK_MS_TTL_MS = 10 * 60_000;
/** Ceiling on one read's range, whatever the block time says. */
const MAX_WINDOW_BLOCKS = 200n;

/**
 * The whole budget for one chain read, across every provider.
 *
 * A provider that hangs must not hold the tape: each attempt gets at most
 * half the budget, and once it is spent the read fails rather than waiting.
 */
export const TAPE_RPC_BUDGET_MS = 3_000;
const TAPE_RPC_ATTEMPT_MS = 1_500;

/** Blocks covering `windowMs` at `blockMs` a block, bounded both ways. */
export function windowBlocks(
  blockMs: number,
  windowMs = TAPE_WINDOW_MS,
): bigint {
  const per = Number.isFinite(blockMs) && blockMs > 0 ? blockMs : DEFAULT_BLOCK_MS;
  const blocks = BigInt(Math.ceil(windowMs / per));
  if (blocks < 2n) return 2n;
  return blocks > MAX_WINDOW_BLOCKS ? MAX_WINDOW_BLOCKS : blocks;
}

/**
 * How long one token's head-of-tape answer stands.
 *
 * Zero meant every reader of every token asked the chain directly, with no
 * cache and — because the cache helper is also where in-flight requests are
 * shared — no deduplication either. Ten people watching one token in the same
 * second produced twenty chain requests, seventeen of them byte-identical.
 * Measured, not inferred.
 *
 * Deliberately just under the two-second poll cadence: short enough that no
 * reader is ever handed something older than their own refresh interval, long
 * enough that simultaneous readers of a token collapse onto one request.
 */
const TTL_MS = 1_500;

/**
 * How long the chain head stands, shared by every token.
 *
 * Every tape read began by asking for the block number, so the cost scaled
 * with viewers times tokens for a number that is the same for all of them and
 * changes about once a second.
 */
const HEAD_TTL_MS = 1_000;

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

/** A provider's host, for errors and logs. Never the URL: keys live in the path. */
function providerName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "rpc";
  }
}

/**
 * One JSON-RPC call, tried on each configured provider in turn.
 *
 * Any failure moves on to the next provider: an HTTP error, a JSON-RPC error,
 * a timeout, a body that is not JSON. It used to move on only for rate limits,
 * so a provider that rejected every `eth_getLogs` outright ("JSON is not a
 * valid request object") ended the read on the first try, and the tape fell
 * back to the indexer's two-minute-old fills without anyone being told.
 *
 * Throws only when every provider has failed or the budget is spent, with each
 * provider's reason in the message.
 */
export async function rpc<T>(
  method: string,
  params: unknown[],
  deadline = Date.now() + TAPE_RPC_BUDGET_MS,
): Promise<T> {
  const failures: string[] = [];

  for (const url of httpRpcUrls()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failures.push("out of time");
      break;
    }
    recordCalls([method]);
    const name = providerName(url);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        cache: "no-store",
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
        signal: AbortSignal.timeout(Math.min(TAPE_RPC_ATTEMPT_MS, remaining)),
      });
      if (!res.ok) {
        failures.push(`${name}: HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {result?: T; error?: {message?: string}};
      if (body.error) {
        failures.push(`${name}: ${body.error.message ?? "error"}`);
        continue;
      }
      return body.result as T;
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "timed out"
          : error instanceof Error
            ? error.message
            : String(error);
      failures.push(`${name}: ${reason}`);
    }
  }

  throw new Error(
    `${method} failed on every provider (${failures.join("; ") || "none configured"})`,
  );
}

/** The chain head, read once a second for the whole process. */
async function headBlock(deadline?: number): Promise<bigint> {
  const hex = await cachedLocal("chain:head", HEAD_TTL_MS, () =>
    rpc<string>("eth_blockNumber", [], deadline),
  );
  return BigInt(hex);
}

/**
 * Block timestamps, bounded.
 *
 * Every read in a four-second window asks about the same few dozen blocks, and
 * a block's time never changes. Kept here rather than in the shared cache: a
 * key per block at ten blocks a second would grow that store without limit.
 */
const BLOCK_TIMES_MAX = 2_048;
const blockTimes = new Map<string, number>();

async function blockTimeMs(blockHex: string, deadline?: number): Promise<number> {
  const known = blockTimes.get(blockHex);
  if (known != null) return known;
  const block = await rpc<{timestamp: string}>(
    "eth_getBlockByNumber",
    [blockHex, false],
    deadline,
  );
  const at = parseInt(block.timestamp, 16) * 1000;
  if (blockTimes.size >= BLOCK_TIMES_MAX) {
    const oldest = blockTimes.keys().next().value;
    if (oldest != null) blockTimes.delete(oldest);
  }
  blockTimes.set(blockHex, at);
  return at;
}

/**
 * The chain's block time, estimated every ten minutes. Falls back to the
 * measured 100ms when the estimate cannot be made — and caches that fallback
 * too, so a provider that refuses the sample is not asked again on every read.
 */
async function blockMs(deadline?: number): Promise<number> {
  return cachedLocal("chain:block-ms", BLOCK_MS_TTL_MS, async () => {
    try {
      const head = await headBlock(deadline);
      const back = head > BLOCK_SAMPLE ? head - BLOCK_SAMPLE : 0n;
      const [newest, oldest] = await Promise.all([
        blockTimeMs("0x" + head.toString(16), deadline),
        blockTimeMs("0x" + back.toString(16), deadline),
      ]);
      const per = (newest - oldest) / Number(head - back);
      return per > 0 ? per : DEFAULT_BLOCK_MS;
    } catch {
      return DEFAULT_BLOCK_MS;
    }
  });
}

const isPoolId = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

/**
 * Decimals for the tokens a pool trades.
 *
 * Every amount used to be divided by 1e18. USDG has six decimals, so on every
 * USDG pool — most of the stocks — the dollar leg came out a trillion times too
 * small and a $1,000 fill printed as $0.00 at a price of $0.0000000002. It went
 * unseen because this read was failing in production; fixing that would have
 * put it on every tape.
 */
const KNOWN_DECIMALS = new Map<string, number>([
  ["0x5fc5360d0400a0fd4f2af552add042d716f1d168", 6], // USDG
  ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", 18], // WETH
  ["0x0000000000000000000000000000000000000000", 18], // ETH
]);
const DECIMALS_MAX = 1_024;
const readDecimals = new Map<string, number>();

/**
 * A token's decimals, or null when they cannot be known right now.
 *
 * Never a guess. Assuming 18 when the read failed is the $0.00 bug again for
 * any 6-decimal token whose first read was slow. Only a real answer is
 * remembered, so an unknown token is asked again on the next read.
 */
export async function decimalsOf(
  address: string,
  deadline?: number,
): Promise<number | null> {
  const key = address.toLowerCase();
  const known = KNOWN_DECIMALS.get(key) ?? RWA_BY_ADDRESS.get(key)?.decimals;
  if (known != null) return known;
  const read = readDecimals.get(key);
  if (read != null) return read;
  try {
    const hex = await rpc<string>(
      "eth_call",
      [{to: key, data: "0x313ce567"}, "latest"],
      deadline,
    );
    const value = parseInt(hex, 16);
    // decimals() is a uint8; anything else is a contract that did not answer
    // the question, not a number to price with.
    if (!Number.isInteger(value) || value < 0 || value > 36) return null;
    if (readDecimals.size >= DECIMALS_MAX) {
      const oldest = readDecimals.keys().next().value;
      if (oldest != null) readDecimals.delete(oldest);
    }
    readDecimals.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/** A raw integer amount in whole tokens. */
export function scaled(raw: bigint, decimals: number): number {
  const abs = raw < 0n ? -raw : raw;
  return Number(abs) / 10 ** decimals;
}

/**
 * Recent fills for one pool.
 *
 * `token` is the asset whose page this is; amounts and sides are expressed from
 * its point of view, so a pool that quotes the other way round still reads
 * correctly.
 */
export async function recentSwaps(
  pool: string,
  token: string,
  quote: string,
  priceUsd: number,
  /** USD price of the quote asset — USDG is 1, RWAs from Robinhood mid. */
  quotePriceUsd: number | null = null,
): Promise<Trade[]> {
  const ours = token.toLowerCase();

  const load = async (): Promise<Trade[]> => {
    const other = quote.toLowerCase();
    const quoteSymbol = QUOTE_ASSETS.get(other);

    // Uniswap orders a pool's currencies by address, so which of the two
    // amounts is ours follows from comparing them — no need to ask the pool.
    const oursIsToken0 = ours < other;

    const deadline = Date.now() + TAPE_RPC_BUDGET_MS;
    const [head, perBlock] = await Promise.all([headBlock(deadline), blockMs(deadline)]);
    const span = windowBlocks(perBlock);
    const from = "0x" + (head > span ? head - span : 0n).toString(16);
    const to = "0x" + head.toString(16);

    const v4 = isPoolId(pool);

    const filter = v4
      ? {fromBlock: from, toBlock: to, address: POOL_MANAGER, topics: [V4_SWAP, pool]}
      : {fromBlock: from, toBlock: to, address: pool, topics: [V3_SWAP]};

    const logs = await rpc<RawLog[]>("eth_getLogs", [filter], deadline);
    if (logs.length === 0) return [];

    const [ourDecimals, quoteDecimals] = await Promise.all([
      decimalsOf(ours, deadline),
      decimalsOf(other, deadline),
    ]);
    // Without both, no fill from this read can be sized honestly. The read
    // fails instead: the tape says the live feed is down and shows the
    // indexer's fills, which carry their own amounts, until a later read
    // learns the decimals.
    if (ourDecimals == null || quoteDecimals == null) {
      throw new Error(
        `decimals unknown for ${ourDecimals == null ? ours : other}; fills not priced`,
      );
    }

    // One lookup per block rather than per fill: a busy pool puts a dozen
    // swaps in the same block.
    const blocks = [...new Set(logs.map((log) => log.blockNumber))];
    const times = new Map<string, number>();

    await Promise.all(
      blocks.map(async (blockNumber) => {
        try {
          times.set(blockNumber, await blockTimeMs(blockNumber, deadline));
        } catch {
          // A block we cannot time is a fill we cannot place.
        }
      }),
    );

    const shape = v4
      ? parseAbiParameters("int128,int128,uint160,uint128,int24,uint24")
      : parseAbiParameters("int256,int256,uint160,uint128,int24");

    const trades: Trade[] = [];

    for (const log of logs) {
      const at = times.get(log.blockNumber);
      if (!at) continue;

      let amount0: bigint;
      let amount1: bigint;
      try {
        const decoded = decodeAbiParameters(shape, log.data as `0x${string}`);
        amount0 = decoded[0] as bigint;
        amount1 = decoded[1] as bigint;
      } catch {
        continue;
      }

      const delta = oursIsToken0 ? amount0 : amount1;
      if (delta === 0n) continue;

      // The two versions sign this oppositely, and getting it backwards prints
      // every buy as a sell.
      //
      // v3 reports the pool's balance change, so our token going negative means
      // the pool paid it out — someone bought. v4 reports the swapper's, so the
      // same trade shows positive.
      //
      // Confirmed on fifty v4 fills matched to the indexer by transaction *and
      // log index*, with nothing unmatched. An earlier attempt matched on the
      // transaction alone and read as a coin flip, because pools here routinely
      // put ten swaps in one transaction — so the hash identified a batch and
      // the comparison was picking an arbitrary member of it.
      const buy = v4 ? delta > 0n : delta < 0n;
      const amount = scaled(delta, ourDecimals);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const quoteDelta = oursIsToken0 ? amount1 : amount0;
      const quoteAmount = scaled(quoteDelta, quoteDecimals);

      // Size the fill from the quote leg when we know that asset's USD price.
      // DexScreener and the indexer both do this; token spot × amount is wrong
      // on RWA-paired pools (e.g. OUROBOROS/CRCL).
      let executionPrice = priceUsd;
      let amountUsd = amount * priceUsd;
      const quoteAbs =
        Number.isFinite(quoteAmount) && quoteAmount > 0 ? quoteAmount : 0;

      if (quoteSymbol === "USDG" && quoteAbs > 0) {
        amountUsd = quoteAbs;
        executionPrice = quoteAbs / amount;
      } else if (quotePriceUsd != null && quotePriceUsd > 0 && quoteAbs > 0) {
        amountUsd = quoteAbs * quotePriceUsd;
        executionPrice = amountUsd / amount;
      }

      trades.push({
        id: `${log.transactionHash}-${parseInt(log.logIndex, 16)}`,
        side: buy ? "buy" : "sell",
        amount,
        amountUsd,
        priceUsd: executionPrice,
        // The second indexed argument is the recipient on a v3 pool and the
        // swap's sender on v4; either is the closest thing to a counterparty
        // without paying for a transaction lookup per fill.
        maker: log.topics[2] ? "0x" + log.topics[2].slice(26) : "0x",
        txHash: log.transactionHash,
        makerHandle: null,
        at: new Date(at).toISOString(),
      });
    }

    return trades.sort(compareTradesNewestFirst);
  };

  // A failed read throws. It used to return an empty list, which the tape
  // could not tell apart from "no fills in the last few seconds", so a dead
  // feed looked like a quiet market and nothing said the tape was stale.
  return cachedLocal(`swaps:${pool}:${ours}`, TTL_MS, load);
}
