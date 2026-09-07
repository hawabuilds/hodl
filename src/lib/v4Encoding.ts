import {encodeAbiParameters, keccak256} from "viem";

/**
 * Universal Router 2.1.1 / V4 Router action encoding.
 *
 * Command `0x10` is V4_SWAP. The input is `abi.encode(actions, params)`
 * where `actions` is a packed byte string and `params[i]` matches
 * `actions[i]`. Robinhood 4663 has no UR 2.0; the swap struct must include
 * `minHopPriceX36` or the router rejects the payload.
 */

export const UR_COMMAND_V4_SWAP = 0x10;

export const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
export const V4_ACTION_SETTLE = 0x0b;
export const V4_ACTION_SETTLE_ALL = 0x0c;
export const V4_ACTION_TAKE = 0x0e;
export const V4_ACTION_TAKE_ALL = 0x0f;

/** Uniswap `ActionConstants.CONTRACT_BALANCE` — SETTLE the router's ERC-20. */
export const V4_CONTRACT_BALANCE = 1n << 255n;
/** Uniswap `ActionConstants.OPEN_DELTA` — SWAP whatever SETTLE just credited. */
export const V4_OPEN_DELTA = 0n;

/** Universal Router maps this recipient to `address(this)`. */
export const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;
/** Universal Router maps this recipient to `msg.sender`. */
export const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001" as const;

export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

const POOL_KEY_COMPONENTS = [
  {name: "currency0", type: "address"},
  {name: "currency1", type: "address"},
  {name: "fee", type: "uint24"},
  {name: "tickSpacing", type: "int24"},
  {name: "hooks", type: "address"},
] as const;

export function v4PoolId(key: V4PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{type: "tuple", components: [...POOL_KEY_COMPONENTS]}],
      [key],
    ),
  );
}

export function packActions(actions: number[]): `0x${string}` {
  return `0x${actions.map((action) => action.toString(16).padStart(2, "0")).join("")}`;
}

export interface V4ExactInSingle {
  poolKey: V4PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  minHopPriceX36?: bigint;
  hookData?: `0x${string}`;
  /** false = tokens already on the router (Long tokens block Permit2). */
  payerIsUser?: boolean;
  /**
   * Prior hop already left `currencyIn` on the router. Settle that
   * balance first and swap the open delta — never a quoted hop size.
   * A quoted second hop is what reverted stock-paired buys.
   */
  fromRouterBalance?: boolean;
  /** Keep the output on the router for a later hop or WETH unwrap. */
  takeToRouter?: boolean;
}

/**
 * Calldata for `UniversalRouter.execute(commands, inputs, deadline)`.
 *
 * Shape:
 *   commands = 0x10
 *   inputs[0] = abi.encode(
 *     bytes actions = 0x06_0c_0f,
 *     bytes[] params = [
 *       ExactInputSingleParams{poolKey, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36, hookData},
 *       SETTLE_ALL(currencyIn, amountIn),
 *       TAKE_ALL(currencyOut, amountOutMinimum),
 *     ]
 *   )
 */
export function encodeV4SwapExactInSingle(swap: V4ExactInSingle): {
  commands: `0x${string}`;
  inputs: `0x${string}`[];
  actions: `0x${string}`;
  currencyIn: `0x${string}`;
  currencyOut: `0x${string}`;
} {
  const currencyIn = swap.zeroForOne
    ? swap.poolKey.currency0
    : swap.poolKey.currency1;
  const currencyOut = swap.zeroForOne
    ? swap.poolKey.currency1
    : swap.poolKey.currency0;

  const settleFromRouter = swap.payerIsUser === false || swap.fromRouterBalance === true;
  const swapAmountIn = swap.fromRouterBalance ? V4_OPEN_DELTA : swap.amountIn;
  const settleAmount = swap.fromRouterBalance ? V4_CONTRACT_BALANCE : swap.amountIn;

  const swapParams = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {name: "poolKey", type: "tuple", components: [...POOL_KEY_COMPONENTS]},
          {name: "zeroForOne", type: "bool"},
          {name: "amountIn", type: "uint128"},
          {name: "amountOutMinimum", type: "uint128"},
          {name: "minHopPriceX36", type: "uint256"},
          {name: "hookData", type: "bytes"},
        ],
      },
    ],
    [
      {
        poolKey: swap.poolKey,
        zeroForOne: swap.zeroForOne,
        amountIn: swapAmountIn,
        amountOutMinimum: swap.amountOutMinimum,
        minHopPriceX36: swap.minHopPriceX36 ?? 0n,
        hookData: swap.hookData ?? "0x",
      },
    ],
  );

  const takeAction = swap.takeToRouter ? V4_ACTION_TAKE : V4_ACTION_TAKE_ALL;
  const actions = packActions(
    swap.fromRouterBalance
      ? [V4_ACTION_SETTLE, V4_ACTION_SWAP_EXACT_IN_SINGLE, takeAction]
      : settleFromRouter
        ? [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE, takeAction]
        : [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, takeAction],
  );

  const settle = settleFromRouter
    ? encodeAbiParameters(
        [{type: "address"}, {type: "uint256"}, {type: "bool"}],
        [currencyIn, settleAmount, false],
      )
    : encodeAbiParameters(
        [{type: "address"}, {type: "uint256"}],
        [currencyIn, settleAmount],
      );
  const take = swap.takeToRouter
    ? encodeAbiParameters(
        [{type: "address"}, {type: "address"}, {type: "uint256"}],
        [currencyOut, UR_ADDRESS_THIS, 0n],
      )
    : encodeAbiParameters(
        [{type: "address"}, {type: "uint256"}],
        [currencyOut, swap.amountOutMinimum],
      );

  const params = swap.fromRouterBalance
    ? [settle, swapParams, take]
    : [swapParams, settle, take];
  const input = encodeAbiParameters(
    [{type: "bytes"}, {type: "bytes[]"}],
    [actions, params],
  );

  return {
    commands: `0x${UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0")}`,
    inputs: [input],
    actions,
    currencyIn,
    currencyOut,
  };
}
