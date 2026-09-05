import {
  encodeAbiParameters,
  encodeFunctionData,
  maxUint256,
  maxUint160,
  parseAbi,
} from "viem";
import {
  PERMIT2,
  QUOTE_ETH,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "./contracts";
import {
  encodeV4SwapExactInSingle,
  UR_COMMAND_V4_SWAP,
  type V4PoolKey,
} from "./v4Encoding";

/** Universal Router command: pull ERC-20 via Permit2 onto the router. */
export const UR_COMMAND_PERMIT2_TRANSFER_FROM = 0x02;
/** Wrap msg.value into WETH and leave it on the router. */
export const UR_COMMAND_WRAP_ETH = 0x0b;

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const permit2Abi = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

const urAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

const router02Abi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

export interface PreparedTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

export function packCommands(commands: number[]): `0x${string}` {
  return `0x${commands.map((command) => command.toString(16).padStart(2, "0")).join("")}`;
}

export function encodeUrExecute(
  commands: `0x${string}`,
  inputs: `0x${string}`[],
  deadline: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: urAbi,
    functionName: "execute",
    args: [commands, inputs, deadline],
  });
}

function encodePermit2Pull(
  token: `0x${string}`,
  amount: bigint,
  recipient: `0x${string}`,
): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "uint160"}, {type: "address"}],
    [token, amount, recipient],
  );
}

function encodeWrapEth(recipient: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "uint256"}],
    [recipient, amount],
  );
}

export function encodeApprove(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint = maxUint256,
): PreparedTx {
  return {
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    }),
    value: 0n,
  };
}

export function encodeTransfer(to: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

export function encodePermit2Approve(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint = maxUint160,
  expiration: number = 2 ** 48 - 1,
): PreparedTx {
  return {
    to: PERMIT2,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args: [token, spender, amount, expiration],
    }),
    value: 0n,
  };
}

export interface V4SwapBuild {
  poolKey: V4PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
  /** Native ETH is already on the router via msg.value. */
  nativeIn?: boolean;
  /** User pays ETH; pool is WETH — wrap first. */
  wrapEth?: boolean;
  /** Tokens are already on the Universal Router (Long / transfer-first). */
  alreadyOnRouter?: boolean;
}

/**
 * Universal Router execute for the venueResolve V4 winner.
 *
 * ERC-20 input prepends Permit2 pull unless `alreadyOnRouter`. Native ETH
 * sends `value`. WETH paid in ETH wraps first. This is the same UR 2.1.1
 * payload `v4Encoding` already tests — not a second venue.
 */
export function buildV4Swap(swap: V4SwapBuild): PreparedTx {
  const encoded = encodeV4SwapExactInSingle({
    poolKey: swap.poolKey,
    zeroForOne: swap.zeroForOne,
    amountIn: swap.amountIn,
    amountOutMinimum: swap.amountOutMinimum,
    payerIsUser: swap.alreadyOnRouter ? false : undefined,
  });

  if (swap.nativeIn) {
    return {
      to: UNIVERSAL_ROUTER,
      data: encodeUrExecute(encoded.commands, encoded.inputs, swap.deadline),
      value: swap.amountIn,
    };
  }

  if (swap.wrapEth) {
    return {
      to: UNIVERSAL_ROUTER,
      data: encodeUrExecute(
        packCommands([UR_COMMAND_WRAP_ETH, UR_COMMAND_V4_SWAP]),
        [encodeWrapEth(UNIVERSAL_ROUTER, swap.amountIn), encoded.inputs[0]],
        swap.deadline,
      ),
      value: swap.amountIn,
    };
  }

  if (swap.alreadyOnRouter) {
    return {
      to: UNIVERSAL_ROUTER,
      data: encodeUrExecute(encoded.commands, encoded.inputs, swap.deadline),
      value: 0n,
    };
  }

  return {
    to: UNIVERSAL_ROUTER,
    data: encodeUrExecute(
      packCommands([UR_COMMAND_PERMIT2_TRANSFER_FROM, UR_COMMAND_V4_SWAP]),
      [
        encodePermit2Pull(encoded.currencyIn, swap.amountIn, UNIVERSAL_ROUTER),
        encoded.inputs[0],
      ],
      swap.deadline,
    ),
    value: 0n,
  };
}

export interface V3SwapBuild {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  recipient: `0x${string}`;
  amountIn: bigint;
  amountOutMinimum: bigint;
  nativeIn?: boolean;
}

/** SwapRouter02 exactInputSingle — the V3 venue resolveVenue already quotes. */
export function buildV3Swap(swap: V3SwapBuild): PreparedTx {
  return {
    to: UNISWAP_SWAP_ROUTER_02,
    data: encodeFunctionData({
      abi: router02Abi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: swap.tokenIn,
          tokenOut: swap.tokenOut,
          fee: swap.fee,
          recipient: swap.recipient,
          amountIn: swap.amountIn,
          amountOutMinimum: swap.amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
    value: swap.nativeIn ? swap.amountIn : 0n,
  };
}

export function isNativeQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_ETH;
}

export function isWethQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_WETH;
}

export {PERMIT2, UNIVERSAL_ROUTER, UNISWAP_SWAP_ROUTER_02, maxUint256, maxUint160};
