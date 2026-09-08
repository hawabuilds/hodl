import {parseAbi, type PublicClient} from "viem";
import {
  LONG_AIRLOCK_FACTORY,
  LONG_DOPPLER_HOOK,
  LONG_V4_FEE,
  LONG_V4_TICK_SPACING,
  PONS_V2_FACTORY,
  PONS_V4_FEE,
  PONS_V4_HOOK,
  PONS_V4_TICK_SPACING,
  QUOTE_WETH,
  UNISWAP_V4_QUOTER,
} from "@/lib/contracts";
import {v4PoolId, type V4PoolKey} from "@/lib/v4Encoding";
import type {LaunchpadId} from "@/lib/universe";
import {rpc, multicallChunked} from "./chain";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const NATIVE_ETH = ZERO;

/** Native ETH and WETH are different PoolKeys. Try both when either appears. */
export function ethQuoteAlternates(quote: `0x${string}`): `0x${string}`[] {
  const value = quote.toLowerCase() as `0x${string}`;
  if (value === ZERO || value === QUOTE_WETH) return [ZERO, QUOTE_WETH];
  return [value];
}

const ponsFactoryAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
]);
const airlockAbi = parseAbi([
  "function getAssetData(address) view returns (address numeraire, address timelock, address governance, address liquidityMigrator, address poolInitializer, address pool)",
]);

const ponsHookAbi = parseAbi([
  "function launches(bytes32) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)",
]);

const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export interface V4PoolHit {
  key: V4PoolKey;
  poolId: `0x${string}`;
  quote: `0x${string}`;
  tokenIsCurrency0: boolean;
  creatorTaxBps: number;
  source: string;
}

export interface PonsLaunch {
  registered: boolean;
  memecoinIsCurrency0: boolean;
  memecoin: `0x${string}`;
  quoteToken: `0x${string}`;
  creatorTaxBps: number;
}

function asAddress(value: unknown): `0x${string}` | null {
  const text = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(text) || text === ZERO) return null;
  return text as `0x${string}`;
}

export async function readPonsLaunch(
  poolId: `0x${string}`,
  client: PublicClient = rpc(),
): Promise<PonsLaunch | null> {
  if (!/^0x[0-9a-f]{64}$/.test(poolId)) return null;
  try {
    const info = await client.readContract({
      address: PONS_V4_HOOK,
      abi: ponsHookAbi,
      functionName: "launches",
      args: [poolId],
    });
    if (!info[0]) return null;
    const memecoin = asAddress(info[2]);
    const quoteToken = asAddress(info[3]);
    if (!memecoin || !quoteToken) return null;
    return {
      registered: true,
      memecoinIsCurrency0: Boolean(info[1]),
      memecoin,
      quoteToken,
      creatorTaxBps: Number(info[7]),
    };
  } catch {
    return null;
  }
}

function sortedKey(
  token: `0x${string}`,
  quote: `0x${string}`,
  fee: number,
  tickSpacing: number,
  hooks: `0x${string}`,
): V4PoolKey {
  const tokenLow = token.toLowerCase() as `0x${string}`;
  const quoteLow = quote.toLowerCase() as `0x${string}`;
  const currency0 = tokenLow < quoteLow ? tokenLow : quoteLow;
  const currency1 = tokenLow < quoteLow ? quoteLow : tokenLow;
  return {currency0, currency1, fee, tickSpacing, hooks: hooks.toLowerCase() as `0x${string}`};
}

async function fromPonsFactory(
  token: `0x${string}`,
  client: PublicClient,
): Promise<V4PoolHit[]> {
  try {
    const launch = await client.readContract({
      address: PONS_V2_FACTORY.address,
      abi: ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [token],
    });
    if (!launch.exists) return [];
    const tax = Number(launch.creatorTaxBps);
    return ethQuoteAlternates(launch.pairToken.toLowerCase() as `0x${string}`).map((quote) => {
      const key = sortedKey(token, quote, PONS_V4_FEE, PONS_V4_TICK_SPACING, PONS_V4_HOOK);
      return {
        key,
        poolId: v4PoolId(key),
        quote,
        tokenIsCurrency0: key.currency0 === token,
        creatorTaxBps: tax,
        source: "pons.getLaunchedToken",
      };
    });
  } catch {
    return [];
  }
}

async function fromLongAirlock(
  token: `0x${string}`,
  client: PublicClient,
): Promise<V4PoolHit[]> {
  try {
    const data = await client.readContract({
      address: LONG_AIRLOCK_FACTORY.address,
      abi: airlockAbi,
      functionName: "getAssetData",
      args: [token],
    });
    const numeraire = data[0].toLowerCase() as `0x${string}`;
    const initializer = data[4].toLowerCase() as `0x${string}`;
    if (numeraire === ZERO && initializer === ZERO) return [];
    const hooks = initializer !== ZERO ? initializer : LONG_DOPPLER_HOOK;
    return ethQuoteAlternates(numeraire).map((quote) => {
      const key = sortedKey(token, quote, LONG_V4_FEE, LONG_V4_TICK_SPACING, hooks);
      return {
        key,
        poolId: v4PoolId(key),
        quote,
        tokenIsCurrency0: key.currency0 === token,
        creatorTaxBps: 0,
        source: "airlock.getAssetData + Doppler fee 0x800000 tick 8",
      };
    });
  } catch {
    return [];
  }
}

/**
 * PoolKey from the launchpad factory only. Never tokens.pool_address.
 * Native ETH and WETH are both attempted when the factory names either.
 */
export async function resolveV4PoolKeys(opts: {
  token: string;
  client?: PublicClient;
}): Promise<V4PoolHit[]> {
  const client = opts.client ?? rpc();
  const token = opts.token.toLowerCase() as `0x${string}`;
  const pons = await fromPonsFactory(token, client);
  if (pons.length > 0) return pons;
  return fromLongAirlock(token, client);
}

/**
 * Hookless V4 fee/tick pairs on this chain.
 *
 * 100/500/3000/10000 are the factory defaults. Stock/ETH books also use 5%
 * (50000) at tick 200 and 500 — SNOW/ETH `0x9ba5b3c1…` is 50000/500.
 */
export const VANILLA_V4_SPECS = [
  {fee: 100, tickSpacing: 1},
  {fee: 500, tickSpacing: 10},
  {fee: 3000, tickSpacing: 60},
  {fee: 10000, tickSpacing: 200},
  {fee: 50000, tickSpacing: 200},
  {fee: 50000, tickSpacing: 500},
] as const;

function vanillaHitsForQuotes(
  token: `0x${string}`,
  quotes: readonly `0x${string}`[],
): V4PoolHit[] {
  const tokenLow = token.toLowerCase() as `0x${string}`;
  const hits: V4PoolHit[] = [];
  const seen = new Set<string>();
  const quoteList = [
    ...new Set(quotes.flatMap((quote) => ethQuoteAlternates(quote.toLowerCase() as `0x${string}`))),
  ];
  for (const quote of quoteList) {
    if (quote === tokenLow) continue;
    for (const spec of VANILLA_V4_SPECS) {
      const key = sortedKey(tokenLow, quote, spec.fee, spec.tickSpacing, ZERO);
      const poolId = v4PoolId(key);
      if (seen.has(poolId)) continue;
      seen.add(poolId);
      hits.push({
        key,
        poolId,
        quote,
        tokenIsCurrency0: key.currency0 === tokenLow,
        creatorTaxBps: 0,
        source: `vanilla v4 fee=${spec.fee} tick=${spec.tickSpacing}`,
      });
    }
  }
  return hits;
}

/**
 * Every hookless V4 key for these quotes. Used when the pair is a stock and
 * factory discovery (Pons/Long) returns nothing.
 */
export function vanillaV4QuoteCandidates(
  token: `0x${string}`,
  quotes: readonly `0x${string}`[],
): V4PoolHit[] {
  return vanillaHitsForQuotes(token, quotes);
}

/**
 * Hookless V4 keys for tokenized stocks (not Pons/Long). Only keys that
 * match `wantedPoolId` are returned so we do not quote a grid of empty pools.
 */
export function vanillaV4Candidates(
  token: `0x${string}`,
  quotes: readonly `0x${string}`[],
  wantedPoolId?: string | null,
): V4PoolHit[] {
  const wanted = wantedPoolId?.toLowerCase();
  if (!wanted || !/^0x[0-9a-f]{64}$/.test(wanted)) return [];
  return vanillaHitsForQuotes(token, quotes).filter((hit) => hit.poolId.toLowerCase() === wanted);
}

function hitsFromPonsLaunch(
  token: `0x${string}`,
  pairToken: `0x${string}`,
  tax: number,
): V4PoolHit[] {
  return ethQuoteAlternates(pairToken).map((quote) => {
    const key = sortedKey(token, quote, PONS_V4_FEE, PONS_V4_TICK_SPACING, PONS_V4_HOOK);
    return {
      key,
      poolId: v4PoolId(key),
      quote,
      tokenIsCurrency0: key.currency0 === token,
      creatorTaxBps: tax,
      source: "pons.getLaunchedToken",
    };
  });
}

function hitsFromLongAsset(
  token: `0x${string}`,
  numeraire: `0x${string}`,
  initializer: `0x${string}`,
): V4PoolHit[] {
  if (numeraire === ZERO && initializer === ZERO) return [];
  const hooks = initializer !== ZERO ? initializer : LONG_DOPPLER_HOOK;
  return ethQuoteAlternates(numeraire).map((quote) => {
    const key = sortedKey(token, quote, LONG_V4_FEE, LONG_V4_TICK_SPACING, hooks);
    return {
      key,
      poolId: v4PoolId(key),
      quote,
      tokenIsCurrency0: key.currency0 === token,
      creatorTaxBps: 0,
      source: "airlock.getAssetData + Doppler fee 0x800000 tick 8",
    };
  });
}

/**
 * Factory PoolKeys for many tokens. One Multicall3 pass per launchpad.
 * Never uses tokens.pool_address.
 */
export async function resolveV4PoolKeysBatch(
  tokens: {address: string; launchpad?: LaunchpadId | null}[],
): Promise<Map<string, V4PoolHit[]>> {
  const out = new Map<string, V4PoolHit[]>();
  if (tokens.length === 0) return out;

  const pons: `0x${string}`[] = [];
  const longs: `0x${string}`[] = [];
  for (const row of tokens) {
    const address = row.address.toLowerCase() as `0x${string}`;
    if (row.launchpad === "long") longs.push(address);
    else if (row.launchpad === "pons") pons.push(address);
    else {
      pons.push(address);
      longs.push(address);
    }
  }

  if (pons.length > 0) {
    const results = await multicallChunked<
      {
        exists: boolean;
        pairToken: `0x${string}`;
        creatorTaxBps: number;
      }
    >(
      pons.map((token) => ({
        address: PONS_V2_FACTORY.address,
        abi: ponsFactoryAbi,
        functionName: "getLaunchedToken" as const,
        args: [token] as const,
      })),
      "pons.getLaunchedToken",
    );
    for (let i = 0; i < pons.length; i++) {
      const result = results[i];
      if (result.status !== "success" || !result.result?.exists) continue;
      const token = pons[i];
      out.set(token, hitsFromPonsLaunch(
        token,
        result.result.pairToken.toLowerCase() as `0x${string}`,
        Number(result.result.creatorTaxBps),
      ));
    }
  }

  const longNeed = longs.filter((token) => !out.has(token));
  if (longNeed.length > 0) {
    const results = await multicallChunked<
      readonly [
        `0x${string}`,
        `0x${string}`,
        `0x${string}`,
        `0x${string}`,
        `0x${string}`,
        `0x${string}`,
      ]
    >(
      longNeed.map((token) => ({
        address: LONG_AIRLOCK_FACTORY.address,
        abi: airlockAbi,
        functionName: "getAssetData" as const,
        args: [token] as const,
      })),
      "airlock.getAssetData",
    );
    for (let i = 0; i < longNeed.length; i++) {
      const result = results[i];
      if (result.status !== "success" || !result.result) continue;
      const token = longNeed[i];
      const numeraire = result.result[0].toLowerCase() as `0x${string}`;
      const initializer = result.result[4].toLowerCase() as `0x${string}`;
      const hits = hitsFromLongAsset(token, numeraire, initializer);
      if (hits.length > 0) out.set(token, hits);
    }
  }

  return out;
}

export async function resolveV4PoolKey(opts: {
  token: string;
  poolId?: string | null;
  client?: PublicClient;
}): Promise<V4PoolHit | null> {
  const hits = await resolveV4PoolKeys(opts);
  if (opts.poolId) {
    const wanted = opts.poolId.toLowerCase();
    return hits.find((hit) => hit.poolId.toLowerCase() === wanted) ?? hits[0] ?? null;
  }
  return hits[0] ?? null;
}

export async function quoteV4ExactIn(opts: {
  key: V4PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  hookData?: `0x${string}`;
  client?: PublicClient;
}): Promise<{ok: true; amountOut: bigint; gasEstimate: bigint} | {ok: false; error: string}> {
  const client = opts.client ?? rpc();
  try {
    const sim = await client.simulateContract({
      address: UNISWAP_V4_QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: opts.key,
          zeroForOne: opts.zeroForOne,
          exactAmount: opts.amountIn,
          hookData: opts.hookData ?? "0x",
        },
      ],
    });
    return {ok: true, amountOut: sim.result[0], gasEstimate: sim.result[1]};
  } catch (error) {
    return {
      ok: false,
      error: String((error as {shortMessage?: string}).shortMessage ?? error).slice(0, 280),
    };
  }
}
