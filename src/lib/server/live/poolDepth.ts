import {parseAbi} from "viem";
import {UNISWAP_V4_STATE_VIEW} from "@/lib/contracts";
import {multicallChunked} from "./chain";

/**
 * Real quote-side depth of a V4 pool: the quote currency a seller could
 * actually take out.
 *
 * Virtual reserves (L·√P and L/√P) treat the in-range liquidity as if it
 * spanned every price. A launch curve's liquidity sits entirely on the token
 * side, so a pool nobody has bought from read as tens of millions of dollars
 * (2× its market cap) and topped the liquidity sort. Walking the initialized
 * ticks on the quote side and summing each range's real amount gives 0 for an
 * empty curve and the true depth for a traded one.
 *
 * The walk reads the two bitmap words nearest the price (exact there); past
 * them the last range's liquidity is carried to the end of the price range,
 * the same assumption virtual reserves make everywhere. So a traded pool reads
 * as before, and only liquidity that isn't there drops out. Two words keep a
 * price pass to a few extra multicalls.
 */

const stateViewAbi = parseAbi([
  "function getTickBitmap(bytes32 poolId, int16 tick) view returns (uint256 tickBitmap)",
  "function getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
]);

/** Uniswap's TickMath bounds: the walk's tail runs to the end of the range. */
export const MIN_TICK = -887_272;
export const MAX_TICK = 887_272;
/** Bitmap words read per pool, nearest the price first. */
const MAX_WORDS = 2;

export interface DepthPool {
  poolId: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  tickSpacing: number;
  /** Quote is currency1: selling the token pushes the price (and tick) down. */
  quoteIsCurrency1: boolean;
}

const sqrtAt = (tick: number) => Math.pow(1.0001, tick / 2);

/** floor(tick / spacing), matching TickBitmap's compressed tick. */
function compress(tick: number, spacing: number): number {
  return Math.floor(tick / spacing);
}

/** Bitmap word positions covering the quote side of the current tick. */
export function depthWords(
  pool: Pick<DepthPool, "tick" | "tickSpacing" | "quoteIsCurrency1">,
  maxWords: number = MAX_WORDS,
): number[] {
  const current = compress(pool.tick, pool.tickSpacing);
  const first = (pool.quoteIsCurrency1 ? current : current + 1) >> 8;
  const step = pool.quoteIsCurrency1 ? -1 : 1;
  return Array.from({length: maxWords}, (_, i) => first + i * step);
}

/** Initialized ticks inside the walk, nearest to the price first. */
export function initializedTicks(
  pool: Pick<DepthPool, "tick" | "tickSpacing" | "quoteIsCurrency1">,
  bitmaps: Map<number, bigint>,
): number[] {
  const current = compress(pool.tick, pool.tickSpacing);
  const lo = pool.quoteIsCurrency1 ? -Infinity : current + 1;
  const hi = pool.quoteIsCurrency1 ? current : Infinity;
  const out: number[] = [];
  for (const [word, bits] of bitmaps) {
    if (bits === 0n) continue;
    for (let bit = 0; bit < 256; bit++) {
      if (((bits >> BigInt(bit)) & 1n) === 0n) continue;
      const compressed = word * 256 + bit;
      if (compressed >= lo && compressed <= hi) out.push(compressed * pool.tickSpacing);
    }
  }
  return out.sort((a, b) => (pool.quoteIsCurrency1 ? b - a : a - b));
}

/**
 * Raw quote units held between the current price and the edge of the walk.
 * `liquidityNet` is keyed by tick; crossing down subtracts it, crossing up
 * adds it — the same rule the pool applies when a swap crosses the tick.
 */
export function quoteDepthRaw(
  pool: Omit<DepthPool, "poolId">,
  ticks: number[],
  liquidityNet: Map<number, bigint>,
): number {
  let sqrt = Number(pool.sqrtPriceX96) / 2 ** 96;
  if (!(sqrt > 0) || !Number.isFinite(sqrt)) return 0;
  let liquidity = Number(pool.liquidity);
  const edge = pool.quoteIsCurrency1 ? MIN_TICK : MAX_TICK;
  let amount = 0;
  const segment = (to: number) => {
    if (liquidity <= 0) return;
    amount += pool.quoteIsCurrency1
      ? liquidity * (sqrt - to)
      : liquidity * (1 / sqrt - 1 / to);
  };
  for (const tick of ticks) {
    const to = sqrtAt(tick);
    segment(to);
    const net = Number(liquidityNet.get(tick) ?? 0n);
    liquidity = pool.quoteIsCurrency1 ? liquidity - net : liquidity + net;
    sqrt = to;
  }
  segment(sqrtAt(edge));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * Quote depth (raw units) per pool id. A pool missing from the result could
 * not be read — callers keep its liquidity unmeasured rather than guess.
 */
export async function readQuoteDepths(
  pools: DepthPool[],
  maxWords: number = MAX_WORDS,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (pools.length === 0) return out;

  const wordCalls: {pool: number; word: number}[] = [];
  pools.forEach((pool, index) => {
    for (const word of depthWords(pool, maxWords)) wordCalls.push({pool: index, word});
  });
  const words = await multicallChunked<bigint>(
    wordCalls.map(({pool, word}) => ({
      address: UNISWAP_V4_STATE_VIEW,
      abi: stateViewAbi,
      functionName: "getTickBitmap" as const,
      args: [pools[pool].poolId, word] as const,
    })),
    "stateView.getTickBitmap",
  );
  const bitmaps = pools.map(() => new Map<number, bigint>());
  const failed = new Set<number>();
  wordCalls.forEach(({pool, word}, i) => {
    const row = words[i];
    if (row?.status !== "success" || row.result == null) failed.add(pool);
    else bitmaps[pool].set(word, row.result);
  });

  const tickCalls: {pool: number; tick: number}[] = [];
  const ticksByPool = pools.map((pool, index) =>
    failed.has(index) ? [] : initializedTicks(pool, bitmaps[index]),
  );
  ticksByPool.forEach((ticks, pool) => {
    for (const tick of ticks) tickCalls.push({pool, tick});
  });
  const nets = await multicallChunked<readonly [bigint, bigint]>(
    tickCalls.map(({pool, tick}) => ({
      address: UNISWAP_V4_STATE_VIEW,
      abi: stateViewAbi,
      functionName: "getTickLiquidity" as const,
      args: [pools[pool].poolId, tick] as const,
    })),
    "stateView.getTickLiquidity",
  );
  const netByPool = pools.map(() => new Map<number, bigint>());
  tickCalls.forEach(({pool, tick}, i) => {
    const row = nets[i];
    if (row?.status !== "success" || !row.result) failed.add(pool);
    else netByPool[pool].set(tick, row.result[1]);
  });

  pools.forEach((pool, index) => {
    if (failed.has(index)) return;
    out.set(pool.poolId.toLowerCase(), quoteDepthRaw(pool, ticksByPool[index], netByPool[index]));
  });
  return out;
}
