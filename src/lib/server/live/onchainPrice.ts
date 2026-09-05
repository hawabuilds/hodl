import {parseAbi} from "viem";
import {
  QUOTE_ETH,
  QUOTE_USDG,
  QUOTE_WETH,
  UNISWAP_V4_STATE_VIEW,
  WETH_USDG_V3_POOL,
} from "@/lib/contracts";
import {normalizeAddress} from "@/lib/address";
import {type PriceStatus} from "@/lib/priceState";
import {quoteKindFor, type LaunchpadId, type QuoteKind} from "@/lib/universe";
import {cached} from "./cache";
import {multicallChunked, rpc} from "./chain";
import {cachedQuotes, quotes, RWA_BY_ADDRESS} from "./robinhood";
import {resolveV4PoolKeysBatch, type V4PoolHit} from "./v4Pools";
import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {
  CRON_PRICE_PAGE,
  listListedForPricing,
  statsFor,
  upsertStats,
  upsertTokens,
  type TokenRow,
  type TokenStatRow,
  type TokenWrite,
} from "./universeStore";

const Q96 = 2n ** 96n;
const ETH_USD_TTL_MS = 30_000;

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

const v3Slot0Abi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

export interface PriceableToken {
  address: string;
  launchpad: LaunchpadId;
  decimals?: number;
  total_supply?: number | null;
  quote_token?: string | null;
  quote_kind?: QuoteKind | null;
}

export interface OnchainPriceRow {
  address: string;
  last_price: number | null;
  last_mcap: number | null;
  liquidity_usd: number | null;
  vol_24h: number | null;
  price_change_24h: number | null;
  priced_at: string | null;
  price_status: PriceStatus | null;
}

export interface PriceBatchResult {
  rows: OnchainPriceRow[];
  priced: number;
  noPool: number;
  failed: number;
  unevaluated: number;
}

/**
 * currency1 per currency0 in raw units, then human token-in-quote.
 * Number is display precision — market caps, not settlement.
 */
export function tokenPriceInQuote(
  sqrtPriceX96: bigint,
  tokenIsCurrency0: boolean,
  tokenDecimals: number,
  quoteDecimals: number,
): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  if (!Number.isFinite(sqrt) || sqrt <= 0) return 0;
  const raw = sqrt * sqrt;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const price = tokenIsCurrency0
    ? raw * 10 ** (tokenDecimals - quoteDecimals)
    : (1 / raw) * 10 ** (quoteDecimals - tokenDecimals);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/** Virtual reserves from V4 liquidity and sqrtPrice. Raw token units. */
export function virtualReserves(
  sqrtPriceX96: bigint,
  liquidity: bigint,
): {amount0: number; amount1: number} {
  if (sqrtPriceX96 <= 0n || liquidity <= 0n) return {amount0: 0, amount1: 0};
  const sqrt = Number(sqrtPriceX96);
  const l = Number(liquidity);
  const q96 = Number(Q96);
  const amount0 = (l * q96) / sqrt;
  const amount1 = (l * sqrt) / q96;
  return {
    amount0: Number.isFinite(amount0) && amount0 > 0 ? amount0 : 0,
    amount1: Number.isFinite(amount1) && amount1 > 0 ? amount1 : 0,
  };
}

export function ethUsdFromWethUsdgSqrt(sqrtPriceX96: bigint): number {
  // WETH token0 (18), USDG token1 (6). raw * 1e12 = USD per ETH.
  return tokenPriceInQuote(sqrtPriceX96, true, 18, 6);
}

export async function ethUsd(): Promise<number | null> {
  return cached("ethUsd:weth-usdg-v3", ETH_USD_TTL_MS, async () => {
    try {
      const slot = await rpc().readContract({
        address: WETH_USDG_V3_POOL,
        abi: v3Slot0Abi,
        functionName: "slot0",
      });
      const price = ethUsdFromWethUsdgSqrt(slot[0]);
      return price > 0 ? price : null;
    } catch (error) {
      console.error("ETH/USD slot0 failed", error);
      return null;
    }
  });
}

function quoteDecimals(quote: string, kind: QuoteKind | null): number {
  const address = normalizeAddress(quote);
  if (kind === "usdg" || address === QUOTE_USDG) return 6;
  if (kind === "eth" || address === QUOTE_WETH || address === QUOTE_ETH) return 18;
  const rwa = RWA_BY_ADDRESS.get(address);
  return rwa?.decimals ?? 18;
}

function quoteUsd(
  quote: string,
  kind: QuoteKind | null,
  eth: number | null,
  rh: Map<string, {priceUsd: number}>,
): number | null {
  const address = normalizeAddress(quote);
  if (kind === "usdg" || address === QUOTE_USDG) return 1;
  if (kind === "eth" || address === QUOTE_WETH || address === QUOTE_ETH) {
    return eth != null && eth > 0 ? eth : null;
  }
  const rwa = RWA_BY_ADDRESS.get(address);
  if (!rwa) return null;
  const held = rh.get(rwa.ticker);
  return held && held.priceUsd > 0 ? held.priceUsd : null;
}

interface PoolState {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  unreachable: boolean;
}

async function readPoolStates(
  poolIds: `0x${string}`[],
): Promise<Map<string, PoolState>> {
  const out = new Map<string, PoolState>();
  if (poolIds.length === 0) return out;

  const slotContracts = poolIds.map((poolId) => ({
    address: UNISWAP_V4_STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getSlot0" as const,
    args: [poolId] as const,
  }));
  const liqContracts = poolIds.map((poolId) => ({
    address: UNISWAP_V4_STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getLiquidity" as const,
    args: [poolId] as const,
  }));

  const [slots, liqs] = await Promise.all([
    multicallChunked<readonly [bigint, number, number, number]>(
      slotContracts,
      "stateView.getSlot0",
    ),
    multicallChunked<bigint>(liqContracts, "stateView.getLiquidity"),
  ]);

  for (let i = 0; i < poolIds.length; i++) {
    const slot = slots[i];
    const liq = liqs[i];
    const unreachable = Boolean(slot?.unreachable || liq?.unreachable);
    const sqrt =
      slot?.status === "success" && slot.result ? slot.result[0] : 0n;
    const liquidity = liq?.status === "success" && liq.result != null ? liq.result : 0n;
    out.set(poolIds[i].toLowerCase(), {
      sqrtPriceX96: sqrt,
      liquidity,
      unreachable,
    });
  }
  return out;
}

function pickLiveHit(
  hits: V4PoolHit[],
  states: Map<string, PoolState>,
): {hit: V4PoolHit; state: PoolState} | {unreachable: true} | null {
  let sawUnreachable = false;
  let empty: {hit: V4PoolHit; state: PoolState} | null = null;
  for (const hit of hits) {
    const state = states.get(hit.poolId.toLowerCase());
    if (!state) continue;
    if (state.unreachable) {
      sawUnreachable = true;
      continue;
    }
    if (state.sqrtPriceX96 > 0n && state.liquidity > 0n) {
      return {hit, state};
    }
    if (state.sqrtPriceX96 > 0n || state.liquidity === 0n) {
      empty = {hit, state};
    }
  }
  if (empty) return empty;
  if (sawUnreachable) return {unreachable: true};
  return null;
}

function finish(
  address: string,
  status: PriceStatus | null,
  fields?: Partial<OnchainPriceRow>,
): OnchainPriceRow {
  const now = new Date().toISOString();
  const priced = status === "priced";
  return {
    address,
    last_price: fields?.last_price ?? null,
    last_mcap: fields?.last_mcap ?? null,
    liquidity_usd: fields?.liquidity_usd ?? null,
    vol_24h: fields?.vol_24h ?? null,
    price_change_24h: fields?.price_change_24h ?? null,
    priced_at: priced ? now : null,
    price_status: status,
  };
}

/**
 * Price tokens from V4 StateView. Writes nothing — caller upserts.
 * Unevaluated (RPC flake / missing quote USD) stays null, not failed.
 */
export async function priceTokensBatch(
  tokens: PriceableToken[],
  held?: Map<string, TokenStatRow>,
): Promise<PriceBatchResult> {
  const rows: OnchainPriceRow[] = [];
  let priced = 0;
  let noPool = 0;
  let failed = 0;
  let unevaluated = 0;
  if (tokens.length === 0) {
    return {rows, priced, noPool, failed, unevaluated};
  }

  const [eth, keys, rh] = await Promise.all([
    ethUsd(),
    resolveV4PoolKeysBatch(tokens),
    quotes().catch(() => cachedQuotes()),
  ]);

  const poolIds: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const hits of keys.values()) {
    for (const hit of hits) {
      const id = hit.poolId.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      poolIds.push(hit.poolId);
    }
  }
  const states = await readPoolStates(poolIds);

  for (const token of tokens) {
    const address = normalizeAddress(token.address);
    const prev = held?.get(address);
    const prior = {
      vol_24h: prev?.vol_24h ?? null,
      price_change_24h: prev?.price_change_24h ?? null,
    };
    const hits = keys.get(address) ?? [];
    if (hits.length === 0) {
      failed += 1;
      if (process.env.PRICE_DEBUG) {
        console.warn("price failed: no PoolKey", {address, launchpad: token.launchpad});
      }
      rows.push(finish(address, "failed", prior));
      continue;
    }

    const live = pickLiveHit(hits, states);
    if (live && "unreachable" in live) {
      unevaluated += 1;
      rows.push(finish(address, null, prior));
      continue;
    }
    if (!live || live.state.sqrtPriceX96 <= 0n) {
      failed += 1;
      if (process.env.PRICE_DEBUG) {
        console.warn("price failed: uninitialized pool", {
          address,
          launchpad: token.launchpad,
          source: hits[0]?.source,
          quotes: hits.map((hit) => hit.quote),
          poolIds: hits.map((hit) => hit.poolId),
        });
      }
      rows.push(finish(address, "failed", prior));
      continue;
    }
    if (live.state.liquidity <= 0n) {
      noPool += 1;
      rows.push(finish(address, "no_pool", prior));
      continue;
    }

    const {hit, state} = live;
    const kind =
      token.quote_kind ??
      quoteKindFor(hit.quote, Boolean(RWA_BY_ADDRESS.get(normalizeAddress(hit.quote))));
    const usd = quoteUsd(hit.quote, kind, eth, rh);
    if (usd == null) {
      unevaluated += 1;
      rows.push(finish(address, null, prior));
      continue;
    }

    const decimals = token.decimals ?? 18;
    const tokenInQuote = tokenPriceInQuote(
      state.sqrtPriceX96,
      hit.tokenIsCurrency0,
      decimals,
      quoteDecimals(hit.quote, kind),
    );
    const priceUsd = tokenInQuote * usd;
    if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) {
      failed += 1;
      rows.push(finish(address, "failed", prior));
      continue;
    }

    const supply = token.total_supply != null ? Number(token.total_supply) : null;
    const mcap =
      supply != null && Number.isFinite(supply) && supply > 0
        ? supply * priceUsd
        : null;
    if (mcap == null || !(mcap > 0) || !Number.isFinite(mcap)) {
      unevaluated += 1;
    }

    const reserves = virtualReserves(state.sqrtPriceX96, state.liquidity);
    const dec0 = hit.tokenIsCurrency0 ? decimals : quoteDecimals(hit.quote, kind);
    const dec1 = hit.tokenIsCurrency0 ? quoteDecimals(hit.quote, kind) : decimals;
    const amt0 = reserves.amount0 / 10 ** dec0;
    const amt1 = reserves.amount1 / 10 ** dec1;
    const liqRaw = hit.tokenIsCurrency0
      ? amt0 * priceUsd + amt1 * usd
      : amt0 * usd + amt1 * priceUsd;
    const liq = Number.isFinite(liqRaw) && liqRaw > 0 ? liqRaw : null;

    priced += 1;
    rows.push(
      finish(address, "priced", {
        ...prior,
        last_price: priceUsd,
        last_mcap: mcap != null && Number.isFinite(mcap) && mcap > 0 ? mcap : null,
        liquidity_usd: liq,
      }),
    );
  }

  return {rows, priced, noPool, failed, unevaluated};
}

export async function writePricedStats(
  result: PriceBatchResult,
): Promise<number> {
  if (result.rows.length === 0) return 0;
  return upsertStats(result.rows);
}

/**
 * Price listed writes and persist stats. Call after the token row exists
 * and before it is marked listed.
 */
export async function priceListedTokens(
  writes: TokenWrite[],
): Promise<PriceBatchResult> {
  const listed = writes.filter((row) => row.status === "listed");
  const result = await priceTokensBatch(
    listed.map((row) => ({
      address: row.address,
      launchpad: row.launchpad,
      decimals: row.decimals,
      total_supply: row.total_supply ?? null,
      quote_token: row.quote_token ?? null,
      quote_kind: row.quote_kind ?? null,
    })),
  );
  try {
    await writePricedStats(result);
  } catch (error) {
    console.error("on-chain price write failed", error);
  }
  if (result.noPool > 0 || result.failed > 0) {
    console.warn("on-chain price unpriceable", {
      priced: result.priced,
      noPool: result.noPool,
      failed: result.failed,
    });
  }
  return result;
}

/**
 * Token row first (not listed), then stats, then listed_at.
 * A bonded token must not appear on New before it has a price attempt.
 */
export async function commitListedWithPrice(writes: TokenWrite[]): Promise<void> {
  const listed = writes.filter((row) => row.status === "listed");
  const pending = writes.filter((row) => row.status !== "listed");
  if (pending.length > 0) await upsertTokens(pending);
  if (listed.length === 0) return;
  await upsertTokens(
    listed.map((row) => ({...row, status: "pending" as const, listed_at: null})),
  );
  try {
    await priceListedTokens(listed);
  } catch (error) {
    console.error("price on insert failed; listing anyway", error);
  }
  await upsertTokens(listed);
}

function asPriceable(row: TokenRow): PriceableToken {
  return {
    address: row.address,
    launchpad: row.launchpad ?? "long",
    decimals: row.decimals,
    total_supply: row.total_supply,
    quote_token: row.quote_token,
    quote_kind: row.quote_kind,
  };
}

export interface RefreshPricesResult extends PriceBatchResult {
  scanned: number;
  ms: number;
  tokensPerMin: number;
}

/**
 * Hot pools every tick, then a small unpriced keyset page.
 * Must finish well under Vercel 60s — never walk the full listed table.
 */
export async function refreshOnchainPrices(opts?: {
  hotLimit?: number;
  unpricedLimit?: number;
  afterAddress?: string | null;
  budgetMs?: number;
}): Promise<RefreshPricesResult> {
  const started = Date.now();
  const deadline = started + (opts?.budgetMs ?? 45_000);
  const hotLimit = opts?.hotLimit ?? 80;
  const unpricedLimit = opts?.unpricedLimit ?? 80;
  const pageSize = CRON_PRICE_PAGE;
  const seen = new Set<string>();
  const batch: TokenRow[] = [];
  const empty: RefreshPricesResult = {
    rows: [],
    priced: 0,
    noPool: 0,
    failed: 0,
    unevaluated: 0,
    scanned: 0,
    ms: 0,
    tokensPerMin: 0,
  };

  const take = (rows: TokenRow[]) => {
    for (const row of rows) {
      const address = normalizeAddress(row.address);
      if (seen.has(address)) continue;
      if (row.launchpad !== "pons" && row.launchpad !== "long") continue;
      seen.add(address);
      batch.push(row);
    }
  };

  try {
    take(
      await listListedForPricing({
        limit: hotLimit,
        minLiquidity: MIN_LIQUIDITY_USD,
      }),
    );
  } catch (error) {
    console.error("hot price list failed", error);
  }

  let after = opts?.afterAddress ?? null;
  while (batch.length < hotLimit + unpricedLimit && Date.now() < deadline) {
    try {
      const page = await listListedForPricing({
        afterAddress: after,
        limit: pageSize,
        onlyUnpriced: true,
      });
      if (page.length === 0) break;
      after = page[page.length - 1]!.address;
      take(page);
      if (page.length < pageSize) break;
    } catch (error) {
      console.error("unpriced price page failed; continuing", error);
      break;
    }
  }

  if (batch.length === 0) {
    return {...empty, ms: Date.now() - started};
  }

  try {
    const held = await statsFor(batch.map((row) => row.address));
    const result = await priceTokensBatch(batch.map(asPriceable), held);
    await writePricedStats(result);
    const ms = Date.now() - started;
    return {
      ...result,
      scanned: batch.length,
      ms,
      tokensPerMin: ms > 0 ? result.rows.length / (ms / 60_000) : 0,
    };
  } catch (error) {
    console.error("price batch failed; continuing", error);
    const ms = Date.now() - started;
    return {...empty, scanned: batch.length, failed: batch.length, ms};
  }
}
