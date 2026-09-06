import {encodeFunctionData, parseAbi, type PublicClient} from "viem";
import {
  MULTICALL3,
  QUOTE_USDG,
  QUOTE_WETH,
  UNISWAP_V3_FACTORY,
  UNISWAP_V3_FEE_TIERS,
} from "@/lib/contracts";
import {rpc} from "./chain";

const ZERO = "0x0000000000000000000000000000000000000000";

const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
]);
const multicallAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) view returns (Result[] returnData)",
]);

export const V3_QUOTES = [QUOTE_WETH, QUOTE_USDG] as const;

export interface V3PoolHit {
  token: string;
  pool: `0x${string}`;
  fee: number;
  quote: `0x${string}`;
  liquidity: bigint;
}

export interface BestV3Pool {
  pool: `0x${string}`;
  fee: number;
  quote: `0x${string}`;
  liquidity: bigint;
  others: V3PoolHit[];
}

function decodeAddress(data: `0x${string}` | undefined): `0x${string}` | null {
  if (!data || data === "0x" || data.length < 66) return null;
  const address = `0x${data.slice(-40)}` as `0x${string}`;
  if (address === ZERO) return null;
  return address;
}

function decodeUint(data: `0x${string}` | undefined): bigint {
  if (!data || data === "0x") return 0n;
  return BigInt(data);
}

export function pickBestPool(hits: V3PoolHit[]): BestV3Pool | null {
  const live = hits.filter((hit) => hit.liquidity > 0n);
  if (live.length === 0) return null;
  const ranked = [...live].sort((a, b) => (a.liquidity === b.liquidity ? 0 : a.liquidity > b.liquidity ? -1 : 1));
  const [best, ...others] = ranked;
  return {
    pool: best.pool,
    fee: best.fee,
    quote: best.quote,
    liquidity: best.liquidity,
    others,
  };
}

function getPoolCalls(tokens: string[], quotes: readonly `0x${string}`[] = V3_QUOTES) {
  const calls: {target: `0x${string}`; allowFailure: true; callData: `0x${string}`}[] = [];
  const keys: {token: string; quote: `0x${string}`; fee: number}[] = [];
  for (const token of tokens) {
    for (const quote of quotes) {
      for (const fee of UNISWAP_V3_FEE_TIERS) {
        keys.push({token: token.toLowerCase(), quote, fee});
        calls.push({
          target: UNISWAP_V3_FACTORY,
          allowFailure: true,
          callData: encodeFunctionData({
            abi: factoryAbi,
            functionName: "getPool",
            args: [token as `0x${string}`, quote, fee],
          }),
        });
      }
    }
  }
  return {calls, keys};
}

async function aggregate(
  client: PublicClient,
  calls: {target: `0x${string}`; allowFailure: true; callData: `0x${string}`}[],
) {
  if (calls.length === 0) return [];
  return client.readContract({
    address: MULTICALL3,
    abi: multicallAbi,
    functionName: "aggregate3",
    args: [calls],
  });
}

/**
 * factory.getPool across WETH + USDG and all four fee tiers, then liquidity()
 * on every non-zero pool. One Multicall3 round-trip for the lookups, one for
 * the liquidity reads.
 */
export async function discoverV3Pools(
  tokens: string[],
  client: PublicClient = rpc(),
  quotes: readonly `0x${string}`[] = V3_QUOTES,
): Promise<Map<string, V3PoolHit[]>> {
  const wanted = [...new Set(tokens.map((token) => token.toLowerCase()))].filter(
    (token) => /^0x[0-9a-f]{40}$/.test(token),
  );
  const out = new Map<string, V3PoolHit[]>();
  for (const token of wanted) out.set(token, []);
  if (wanted.length === 0) return out;

  const quoteList = [...new Set(quotes.map((quote) => quote.toLowerCase() as `0x${string}`))].filter(
    (quote) => /^0x[0-9a-f]{40}$/.test(quote),
  );
  const {calls, keys} = getPoolCalls(wanted, quoteList);
  const found = await aggregate(client, calls);

  const pending: {token: string; quote: `0x${string}`; fee: number; pool: `0x${string}`}[] = [];
  for (let i = 0; i < keys.length; i++) {
    const result = found[i];
    if (!result?.success) continue;
    const pool = decodeAddress(result.returnData);
    if (!pool) continue;
    pending.push({...keys[i], pool: pool.toLowerCase() as `0x${string}`});
  }

  const liqCalls = pending.map((row) => ({
    target: row.pool,
    allowFailure: true as const,
    callData: encodeFunctionData({
      abi: poolAbi,
      functionName: "liquidity",
    }),
  }));
  const liqs = await aggregate(client, liqCalls);

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const liquidity = liqs[i]?.success ? decodeUint(liqs[i].returnData) : 0n;
    out.get(row.token)?.push({
      token: row.token,
      pool: row.pool,
      fee: row.fee,
      quote: row.quote,
      liquidity,
    });
  }
  return out;
}

export async function resolveBestV3Pool(
  token: string,
  client: PublicClient = rpc(),
): Promise<BestV3Pool | null> {
  const hits = (await discoverV3Pools([token], client)).get(token.toLowerCase()) ?? [];
  return pickBestPool(hits);
}

/** Read a known V3 pool (DexScreener pair address) so stock/stock venues quote. */
export async function readV3Pool(
  pool: `0x${string}`,
  client: PublicClient = rpc(),
): Promise<{token0: `0x${string}`; token1: `0x${string}`; fee: number; liquidity: bigint} | null> {
  if (!/^0x[0-9a-f]{40}$/.test(pool)) return null;
  try {
    const [token0, token1, fee, liquidity] = await Promise.all([
      client.readContract({address: pool, abi: poolAbi, functionName: "token0"}),
      client.readContract({address: pool, abi: poolAbi, functionName: "token1"}),
      client.readContract({address: pool, abi: poolAbi, functionName: "fee"}),
      client.readContract({address: pool, abi: poolAbi, functionName: "liquidity"}),
    ]);
    return {
      token0: String(token0).toLowerCase() as `0x${string}`,
      token1: String(token1).toLowerCase() as `0x${string}`,
      fee: Number(fee),
      liquidity: BigInt(liquidity),
    };
  } catch {
    return null;
  }
}
