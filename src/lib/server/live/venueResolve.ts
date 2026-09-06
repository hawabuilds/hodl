import {parseAbi, type PublicClient} from "viem";
import {UNISWAP_QUOTER_V2} from "@/lib/contracts";
import {amountOutFromQuoter, inputAfterBuyFee, pickBestVenue, type VenueCandidate, type VenueDecision} from "@/lib/venueQuote";
import {QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";
import {rpc} from "./chain";
import {discoverV3Pools, pickBestPool, readV3Pool, V3_QUOTES} from "./v3Pools";
import {quoteV4ExactIn, resolveV4PoolKeys, vanillaV4Candidates, type V4PoolHit} from "./v4Pools";

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export interface QuoteRequest {
  token: string;
  /** buy = quote → token; sell = token → quote */
  side: "buy" | "sell";
  amountIn: bigint;
  v4PoolId?: string | null;
  /** Extra quote tokens from the stock's DexScreener pool (not only WETH/USDG). */
  extraQuotes?: string[];
  /** Known V3 pool address when factory discovery would miss a stock/stock pair. */
  v3Pool?: string | null;
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

  const extraQuotes = (req.extraQuotes ?? [])
    .map((quote) => quote.toLowerCase() as `0x${string}`)
    .filter((quote) => /^0x[0-9a-f]{40}$/.test(quote) && quote !== token);

  let v4Hits = await resolveV4PoolKeys({token, client});
  if (v4Hits.length === 0 && req.v4PoolId) {
    v4Hits = vanillaV4Candidates(
      token,
      extraQuotes.length > 0 ? extraQuotes : [QUOTE_WETH, QUOTE_USDG],
      req.v4PoolId,
    );
  }
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
  const extraV3Quotes = extraQuotes.filter(
    (quote) => !(V3_QUOTES as readonly string[]).includes(quote),
  );
  if (extraV3Quotes.length > 0) {
    const more = await discoverV3Pools([token], client, extraV3Quotes);
    v3Hits.get(token)?.push(...(more.get(token) ?? []));
  }
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

  const hintedV3 =
    req.v3Pool && /^0x[0-9a-f]{40}$/.test(req.v3Pool) && req.v3Pool.toLowerCase() !== bestV3?.pool
      ? await readV3Pool(req.v3Pool.toLowerCase() as `0x${string}`, client)
      : null;
  if (hintedV3 && hintedV3.liquidity > 0n && Number.isFinite(hintedV3.fee)) {
    const quote =
      hintedV3.token0 === token
        ? hintedV3.token1
        : hintedV3.token1 === token
          ? hintedV3.token0
          : null;
    if (quote) {
      const tokenIn = req.side === "buy" ? quote : token;
      const tokenOut = req.side === "buy" ? token : quote;
      const amountOut = await quoteV3(tokenIn, tokenOut, hintedV3.fee, quoteIn, client);
      if (amountOut != null) {
        candidates.push({
          venue: "v3",
          amountOut,
          creatorTaxBps: 0,
          quoteToken: quote,
          label: `Dex pool fee=${hintedV3.fee}`,
          v3Fee: hintedV3.fee,
          v3Pool: req.v3Pool!.toLowerCase() as `0x${string}`,
        });
      }
    }
  }

  return pickBestVenue(
    candidates,
    undefined,
    req.side !== "buy",
    req.amountIn,
  );
}
