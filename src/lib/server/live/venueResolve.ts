import {parseAbi, type PublicClient} from "viem";
import {UNISWAP_QUOTER_V2} from "@/lib/contracts";
import {amountOutFromQuoter, inputAfterBuyFee, pickBestVenue, type VenueCandidate, type VenueDecision} from "@/lib/venueQuote";
import {rpc} from "./chain";
import {discoverV3Pools, pickBestPool} from "./v3Pools";
import {quoteV4ExactIn, resolveV4PoolKeys, type V4PoolHit} from "./v4Pools";

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export interface QuoteRequest {
  token: string;
  /** buy = quote → token; sell = token → quote */
  side: "buy" | "sell";
  amountIn: bigint;
  v4PoolId?: string | null;
  client?: PublicClient;
}

async function quoteV3(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
  amountIn: bigint,
  client: PublicClient,
): Promise<bigint | null> {
  try {
    const sim = await client.simulateContract({
      address: UNISWAP_QUOTER_V2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n}],
    });
    return sim.result[0];
  } catch {
    return null;
  }
}

function v4ZeroForOne(hit: V4PoolHit, tokenIn: string): boolean {
  return hit.key.currency0.toLowerCase() === tokenIn.toLowerCase();
}

/**
 * Quote V4 and V3 for this size and pick the better net output.
 *
 * Creator tax on V3 is zero — the hook never runs. That is disclosed on the
 * ticket. It is not a product we market.
 */
export async function resolveVenue(req: QuoteRequest): Promise<VenueDecision | null> {
  const client = req.client ?? rpc();
  const token = req.token.toLowerCase() as `0x${string}`;
  const candidates: VenueCandidate[] = [];

  const quoteIn = req.side === "buy" ? inputAfterBuyFee(req.amountIn) : req.amountIn;
  if (quoteIn <= 0n) return null;

  const v4Hits = await resolveV4PoolKeys({token, client});
  const wantedPool = req.v4PoolId?.toLowerCase();
  const ordered = wantedPool
    ? [
        ...v4Hits.filter((hit) => hit.poolId.toLowerCase() === wantedPool),
        ...v4Hits.filter((hit) => hit.poolId.toLowerCase() !== wantedPool),
      ]
    : v4Hits;
  for (const v4 of ordered) {
    const tokenIn = req.side === "buy" ? v4.quote : token;
    const zeroForOne = v4ZeroForOne(v4, tokenIn);
    const quoted = await quoteV4ExactIn({
      key: v4.key,
      zeroForOne,
      amountIn: quoteIn,
      client,
    });
    if (quoted.ok) {
      candidates.push({
        venue: "v4",
        amountOut: amountOutFromQuoter(quoted.amountOut, v4.creatorTaxBps),
        creatorTaxBps: v4.creatorTaxBps,
        quoteToken: v4.quote,
        label: `${v4.source} fee=${v4.key.fee} tick=${v4.key.tickSpacing}`,
        poolKey: v4.key,
        zeroForOne,
      });
    }
  }

  const v3Hits = await discoverV3Pools([token], client);
  const bestV3 = pickBestPool(v3Hits.get(token) ?? []);
  if (bestV3) {
    const quote = bestV3.quote;
    const tokenIn = req.side === "buy" ? quote : token;
    const tokenOut = req.side === "buy" ? token : quote;
    const amountOut = await quoteV3(tokenIn, tokenOut, bestV3.fee, quoteIn, client);
    if (amountOut != null) {
      candidates.push({
        venue: "v3",
        amountOut,
        creatorTaxBps: 0,
        quoteToken: quote,
        label: `QuoterV2 fee=${bestV3.fee}`,
        v3Fee: bestV3.fee,
        v3Pool: bestV3.pool,
      });
    }
  }

  return pickBestVenue(
    candidates,
    undefined,
    req.side !== "buy",
    req.amountIn,
  );
}
