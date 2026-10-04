import {encodeFunctionData, parseAbi} from "viem";
import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "./contracts";
import type {SwapQuote} from "./swapQuote";
import type {PreparedTx} from "./swapTx";

export const hodlRouterAbi = parseAbi([
  "function buy(address tokenOut, uint128 minAmountOut, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) hint, uint256 deadline) payable",
  "function buyWithToken(address tokenIn, uint256 amountIn, address tokenOut, uint128 minAmountOut, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) hint, uint256 deadline)",
  "function sell(address tokenIn, uint256 amountIn, address tokenOut, uint128 minAmountOut, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) hint, uint256 deadline)",
  "function feeBps() view returns (uint16)",
  "function paused() view returns (bool)",
  "function quoteUsdg(uint256 ethWei) view returns (uint256)",
  "event Trade(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 feeAmount, address feeToken, uint8 venue)",
]);

export interface PoolKeyHint {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function sorted(a: `0x${string}`, b: `0x${string}`): [`0x${string}`, `0x${string}`] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

export function hintFromQuote(
  quote: SwapQuote,
  token: `0x${string}`,
  side: "buy" | "sell",
): PoolKeyHint {
  if (quote.venue === "v4" && quote.poolKey) {
    return quote.poolKey;
  }
  const quoteToken = quote.quoteIsNative ? ZERO : quote.quoteToken;
  const tokenIn = side === "buy" ? quoteToken : token;
  const tokenOut = side === "buy" ? token : quoteToken;
  const [currency0, currency1] = sorted(tokenIn, tokenOut);
  return {
    currency0,
    currency1,
    fee: quote.v3Fee ?? 3000,
    tickSpacing: 0,
    hooks: ZERO,
  };
}

export function encodeHodlBuy(opts: {
  router: `0x${string}`;
  tokenOut: `0x${string}`;
  minAmountOut: bigint;
  hint: PoolKeyHint;
  deadline: bigint;
  value: bigint;
}): PreparedTx {
  return {
    to: opts.router,
    data: encodeFunctionData({
      abi: hodlRouterAbi,
      functionName: "buy",
      args: [opts.tokenOut, opts.minAmountOut, opts.hint, opts.deadline],
    }),
    value: opts.value,
  };
}

export function encodeHodlBuyWithToken(opts: {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  amountIn: bigint;
  tokenOut: `0x${string}`;
  minAmountOut: bigint;
  hint: PoolKeyHint;
  deadline: bigint;
}): PreparedTx {
  return {
    to: opts.router,
    data: encodeFunctionData({
      abi: hodlRouterAbi,
      functionName: "buyWithToken",
      args: [
        opts.tokenIn,
        opts.amountIn,
        opts.tokenOut,
        opts.minAmountOut,
        opts.hint,
        opts.deadline,
      ],
    }),
    value: 0n,
  };
}

export function encodeHodlSell(opts: {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  amountIn: bigint;
  tokenOut: `0x${string}`;
  minAmountOut: bigint;
  hint: PoolKeyHint;
  deadline: bigint;
}): PreparedTx {
  return {
    to: opts.router,
    data: encodeFunctionData({
      abi: hodlRouterAbi,
      functionName: "sell",
      args: [
        opts.tokenIn,
        opts.amountIn,
        opts.tokenOut,
        opts.minAmountOut,
        opts.hint,
        opts.deadline,
      ],
    }),
    value: 0n,
  };
}

export function quoteAssetAddress(quote: SwapQuote): `0x${string}` {
  if (quote.quoteIsNative) return ZERO;
  if (quote.quoteToken === QUOTE_WETH) return QUOTE_WETH;
  if (quote.quoteToken === QUOTE_USDG) return QUOTE_USDG;
  return quote.quoteToken;
}

export {QUOTE_ETH, ZERO};
