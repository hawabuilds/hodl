import {
  decodeFunctionData,
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

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

export function encodeTransfer(to: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

export function isErc20TransferCalldata(data: `0x${string}`): boolean {
  return data.slice(0, 10).toLowerCase() === ERC20_TRANSFER_SELECTOR;
}

/** Recipient of `transfer(address,uint256)`, or null when calldata is not a transfer. */
export function transferRecipient(data: `0x${string}`): `0x${string}` | null {
  if (!isErc20TransferCalldata(data)) return null;
  const decoded = decodeFunctionData({abi: erc20Abi, data});
  if (decoded.functionName !== "transfer") return null;
  return decoded.args[0];
}

/**
 * The failed SPACEHOOD sell: `token.transfer(UniversalRouter, amount)`.
 * Tokens sit on the router; no swap runs.
 */
export function isTransferToSwapRouter(tx: PreparedTx): boolean {
  const recipient = transferRecipient(tx.data);
  if (!recipient) return false;
  const dest = recipient.toLowerCase();
  return dest === UNIVERSAL_ROUTER || dest === UNISWAP_SWAP_ROUTER_02;
}

export function assertSwapNotErc20Transfer(tx: PreparedTx): void {
  if (isErc20TransferCalldata(tx.data) || isTransferToSwapRouter(tx)) {
    throw new Error("Sell must be a swap, not an ERC-20 transfer to the router.");
  }
  const to = tx.to.toLowerCase();
  if (to !== UNIVERSAL_ROUTER && to !== UNISWAP_SWAP_ROUTER_02) {
    throw new Error("Swap must target Universal Router or SwapRouter02.");
  }
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
  /**
   * Tokens already sit on the Universal Router. Ticket code must never
   * transfer user tokens here to set this — that is how SPACEHOOD was lost.
   */
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

export interface ExactInSwapBuild {
  venue: "v4" | "v3";
  side: "buy" | "sell";
  token: `0x${string}`;
  quoteToken: `0x${string}`;
  quoteIsNative?: boolean;
  quoteIsWeth?: boolean;
  poolKey?: V4PoolKey | null;
  v3Fee?: number | null;
  zeroForOne?: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
  recipient: `0x${string}`;
  payNative: boolean;
}

/**
 * Value-moving swap the ticket signs. Always UR `execute` or SwapRouter02
 * `exactInputSingle`. Never `token.transfer(router, amount)`.
 */
export function prepareExactInSwap(swap: ExactInSwapBuild): PreparedTx {
  const nativePay = swap.side === "buy" && swap.payNative;
  if (swap.venue === "v4") {
    if (!swap.poolKey) {
      throw new Error("No Uniswap pool for this token.");
    }
    const tx = buildV4Swap({
      poolKey: swap.poolKey,
      zeroForOne: Boolean(swap.zeroForOne),
      amountIn: swap.amountIn,
      amountOutMinimum: swap.amountOutMinimum,
      deadline: swap.deadline,
      nativeIn: nativePay && swap.quoteIsNative,
      wrapEth: nativePay && swap.quoteIsWeth,
    });
    assertSwapNotErc20Transfer(tx);
    return tx;
  }
  if (swap.v3Fee == null) {
    throw new Error("No Uniswap pool for this token.");
  }
  const tokenIn = swap.side === "buy" ? swap.quoteToken : swap.token;
  const tokenOut = swap.side === "buy" ? swap.token : swap.quoteToken;
  const tx = buildV3Swap({
    tokenIn,
    tokenOut,
    fee: swap.v3Fee,
    recipient: swap.recipient,
    amountIn: swap.amountIn,
    amountOutMinimum: swap.amountOutMinimum,
    nativeIn: nativePay && (swap.quoteIsWeth || swap.quoteIsNative),
  });
  assertSwapNotErc20Transfer(tx);
  return tx;
}

export function isNativeQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_ETH;
}

export function isWethQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_WETH;
}

export {PERMIT2, UNIVERSAL_ROUTER, UNISWAP_SWAP_ROUTER_02, maxUint256, maxUint160};
