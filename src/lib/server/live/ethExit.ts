import {parseAbi, type PublicClient} from "viem";
import {QUOTE_WETH, UNISWAP_QUOTER_V2} from "@/lib/contracts";
import {isEthish, type SwapHop} from "@/lib/swapRoute";
import {rpc} from "./chain";
import {discoverV3Pools, pickBestPool} from "./v3Pools";
import {quoteV4ExactIn, resolveV4PoolKeys} from "./v4Pools";

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export async function quoteV3ExactIn(
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

export interface EthExitHop {
  amountOut: bigint;
  hop: SwapHop;
  quoteToken: `0x${string}`;
}

/**
 * Second hop: pair token (SPCX, USDG, IBM, …) → WETH or native ETH.
 * Returns null when no live hop exists — the ticket must fail honestly.
 */
export async function quotePairToEth(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (isEthish(pair) || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();

  let best: EthExitHop | null = null;

  const v3Hits = await discoverV3Pools([pair], client, [QUOTE_WETH]);
  const bestV3 = pickBestPool(v3Hits.get(pair) ?? []);
  if (bestV3 && bestV3.liquidity > 0n) {
    const amountOut = await quoteV3ExactIn(pair, QUOTE_WETH, bestV3.fee, opts.amountIn, client);
    if (amountOut != null && amountOut > 0n) {
      best = {
        amountOut,
        quoteToken: QUOTE_WETH,
        hop: {
          venue: "v3",
          tokenIn: pair,
          tokenOut: QUOTE_WETH,
          v3Fee: bestV3.fee,
          amountIn: opts.amountIn.toString(),
        },
      };
    }
  }

  const v4Hits = await resolveV4PoolKeys({token: pair, client});
  for (const hit of v4Hits) {
    if (!isEthish(hit.quote)) continue;
    const zeroForOne = hit.key.currency0.toLowerCase() === pair;
    const quoted = await quoteV4ExactIn({
      key: hit.key,
      zeroForOne,
      amountIn: opts.amountIn,
      client,
    });
    if (!quoted.ok || quoted.amountOut <= 0n) continue;
    if (best && quoted.amountOut <= best.amountOut) continue;
    best = {
      amountOut: quoted.amountOut,
      quoteToken: hit.quote,
      hop: {
        venue: "v4",
        tokenIn: pair,
        tokenOut: hit.quote,
        poolKey: hit.key,
        zeroForOne,
        amountIn: opts.amountIn.toString(),
      },
    };
  }

  return best;
}

/**
 * First hop of a stock-paired buy: ETH/WETH → pair (SPCX, IBM, SPY, …).
 * Reverse of `quotePairToEth`. Null when that hop does not exist.
 */
export async function quoteEthToPair(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (isEthish(pair) || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();

  let best: EthExitHop | null = null;

  const v3Hits = await discoverV3Pools([pair], client, [QUOTE_WETH]);
  const bestV3 = pickBestPool(v3Hits.get(pair) ?? []);
  if (bestV3 && bestV3.liquidity > 0n) {
    const amountOut = await quoteV3ExactIn(QUOTE_WETH, pair, bestV3.fee, opts.amountIn, client);
    if (amountOut != null && amountOut > 0n) {
      best = {
        amountOut,
        quoteToken: QUOTE_WETH,
        hop: {
          venue: "v3",
          tokenIn: QUOTE_WETH,
          tokenOut: pair,
          v3Fee: bestV3.fee,
          amountIn: opts.amountIn.toString(),
        },
      };
    }
  }

  const v4Hits = await resolveV4PoolKeys({token: pair, client});
  for (const hit of v4Hits) {
    if (!isEthish(hit.quote)) continue;
    const tokenIn = hit.quote;
    const zeroForOne = hit.key.currency0.toLowerCase() === tokenIn.toLowerCase();
    const quoted = await quoteV4ExactIn({
      key: hit.key,
      zeroForOne,
      amountIn: opts.amountIn,
      client,
    });
    if (!quoted.ok || quoted.amountOut <= 0n) continue;
    if (best && quoted.amountOut <= best.amountOut) continue;
    best = {
      amountOut: quoted.amountOut,
      quoteToken: hit.quote,
      hop: {
        venue: "v4",
        tokenIn: tokenIn,
        tokenOut: pair,
        poolKey: hit.key,
        zeroForOne,
        amountIn: opts.amountIn.toString(),
      },
    };
  }

  return best;
}
