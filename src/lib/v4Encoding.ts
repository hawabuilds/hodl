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
        amountIn: swap.amountIn,
        amountOutMinimum: swap.amountOutMinimum,
        minHopPriceX36: swap.minHopPriceX36 ?? 0n,
        hookData: swap.hookData ?? "0x",
      },
    ],
  );

  const settleFromRouter = swap.payerIsUser === false;
  const takeAction = swap.takeToRouter ? V4_ACTION_TAKE : V4_ACTION_TAKE_ALL;
  const actions = packActions(
    settleFromRouter
      ? [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE, takeAction]
      : [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, takeAction],
  );

  const settle = settleFromRouter
    ? encodeAbiParameters(
        [{type: "address"}, {type: "uint256"}, {type: "bool"}],
        [currencyIn, swap.amountIn, false],
      )
    : encodeAbiParameters(
        [{type: "address"}, {type: "uint256"}],
        [currencyIn, swap.amountIn],
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

  const input = encodeAbiParameters(
    [{type: "bytes"}, {type: "bytes[]"}],
    [actions, [swapParams, settle, take]],
  );

  return {
    commands: `0x${UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0")}`,
    inputs: [input],
    actions,
    currencyIn,
    currencyOut,
  };
}
