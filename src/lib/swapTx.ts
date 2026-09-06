import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  maxUint256,
  maxUint160,
  parseAbi,
  toHex,
} from "viem";
import {
  PERMIT2,
  QUOTE_ETH,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "./contracts";
import {CANT_EXIT_TO_ETH, isEthish, type SwapHop} from "./swapRoute";
import {
  encodeV4SwapExactInSingle,
  UR_ADDRESS_THIS,
  UR_COMMAND_V4_SWAP,
  UR_MSG_SENDER,
  type V4PoolKey,
} from "./v4Encoding";

/** Universal Router command: V3 exact-in. */
export const UR_COMMAND_V3_SWAP_EXACT_IN = 0x00;
/** Universal Router command: pull ERC-20 via Permit2 onto the router. */
export const UR_COMMAND_PERMIT2_TRANSFER_FROM = 0x02;
/** Wrap msg.value into WETH and leave it on the router. */
export const UR_COMMAND_WRAP_ETH = 0x0b;
/** Unwrap WETH on the router and send ETH to the recipient. */
export const UR_COMMAND_UNWRAP_WETH = 0x0c;
/** UR treats this amountIn as `IERC20.balanceOf(address(this))`. */
export const UR_CONTRACT_BALANCE = 1n << 255n;

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

export function encodeV3Path(
  tokenIn: `0x${string}`,
  fee: number,
  tokenOut: `0x${string}`,
): `0x${string}` {
  return concatHex([tokenIn, toHex(fee, {size: 3}), tokenOut]);
}

export function encodeV3ExactIn(opts: {
  recipient: `0x${string}`;
  amountIn: bigint;
  amountOutMinimum: bigint;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  payerIsUser: boolean;
}): `0x${string}` {
  return encodeAbiParameters(
    [
      {type: "address"},
      {type: "uint256"},
      {type: "uint256"},
      {type: "bytes"},
      {type: "bool"},
    ],
    [
      opts.recipient,
      opts.amountIn,
      opts.amountOutMinimum,
      encodeV3Path(opts.tokenIn, opts.fee, opts.tokenOut),
      opts.payerIsUser,
    ],
  );
}

function encodeUnwrapWeth(recipient: `0x${string}`, amountMin: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "uint256"}],
    [recipient, amountMin],
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
  /** Leave the output on the router (next hop or unwrap). */
  takeToRouter?: boolean;
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
    takeToRouter: swap.takeToRouter,
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
  hops?: SwapHop[];
}

function hopsForSwap(swap: ExactInSwapBuild): SwapHop[] {
  if (swap.hops && swap.hops.length > 0) return swap.hops;
  const tokenIn = swap.side === "buy" ? swap.quoteToken : swap.token;
  const tokenOut = swap.side === "buy" ? swap.token : swap.quoteToken;
  if (swap.venue === "v4" && swap.poolKey) {
    return [{
      venue: "v4",
      tokenIn,
      tokenOut,
      poolKey: swap.poolKey,
      zeroForOne: swap.zeroForOne,
    }];
  }
  if (swap.venue === "v3" && swap.v3Fee != null) {
    return [{
      venue: "v3",
      tokenIn,
      tokenOut,
      v3Fee: swap.v3Fee,
    }];
  }
  return [];
}

function encodeHopInput(opts: {
  hop: SwapHop;
  amountIn: bigint;
  amountOutMinimum: bigint;
  takeToRouter: boolean;
}): `0x${string}` {
  if (opts.hop.venue === "v4") {
    if (!opts.hop.poolKey) {
      throw new Error("No Uniswap pool for this token.");
    }
    return encodeV4SwapExactInSingle({
      poolKey: opts.hop.poolKey,
      zeroForOne: Boolean(opts.hop.zeroForOne),
      amountIn: opts.amountIn,
      amountOutMinimum: opts.takeToRouter ? 0n : opts.amountOutMinimum,
      takeToRouter: opts.takeToRouter,
    }).inputs[0];
  }
  if (opts.hop.v3Fee == null) {
    throw new Error("No Uniswap pool for this token.");
  }
  return encodeV3ExactIn({
    recipient: opts.takeToRouter ? UR_ADDRESS_THIS : UR_MSG_SENDER,
    amountIn: opts.amountIn,
    amountOutMinimum: opts.takeToRouter ? 0n : opts.amountOutMinimum,
    tokenIn: opts.hop.tokenIn,
    tokenOut: opts.hop.tokenOut,
    fee: opts.hop.v3Fee,
    payerIsUser: false,
  });
}

/**
 * Sell path: token → … → WETH/ETH via Universal Router, then unwrap WETH.
 * Never leaves the user in SPCX / USDG / a stock token.
 */
export function buildSellToEth(swap: ExactInSwapBuild): PreparedTx {
  const hops = hopsForSwap(swap);
  const tokenOut = hops.length > 0 ? hops[hops.length - 1].tokenOut : swap.quoteToken;
  if (hops.length === 0 || !isEthish(tokenOut)) {
    throw new Error(CANT_EXIT_TO_ETH);
  }
  const unwrap = tokenOut.toLowerCase() === QUOTE_WETH;
  const commands: number[] = [UR_COMMAND_PERMIT2_TRANSFER_FROM];
  const inputs: `0x${string}`[] = [
    encodePermit2Pull(swap.token, swap.amountIn, UNIVERSAL_ROUTER),
  ];

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const last = i === hops.length - 1;
    const takeToRouter = !last || unwrap;
    const amountIn =
      i === 0
        ? swap.amountIn
        : hop.venue === "v3"
          ? UR_CONTRACT_BALANCE
          : BigInt(hop.amountIn ?? "0");
    if (i > 0 && hop.venue === "v4" && amountIn <= 0n) {
      throw new Error(CANT_EXIT_TO_ETH);
    }
    commands.push(hop.venue === "v4" ? UR_COMMAND_V4_SWAP : UR_COMMAND_V3_SWAP_EXACT_IN);
    inputs.push(
      encodeHopInput({
        hop,
        amountIn,
        amountOutMinimum: last && !unwrap ? swap.amountOutMinimum : 0n,
        takeToRouter,
      }),
    );
  }

  if (unwrap) {
    commands.push(UR_COMMAND_UNWRAP_WETH);
    inputs.push(encodeUnwrapWeth(UR_MSG_SENDER, swap.amountOutMinimum));
  }

  const tx: PreparedTx = {
    to: UNIVERSAL_ROUTER,
    data: encodeUrExecute(packCommands(commands), inputs, swap.deadline),
    value: 0n,
  };
  assertSwapNotErc20Transfer(tx);
  return tx;
}

/**
 * Value-moving swap the ticket signs. Always UR `execute` or SwapRouter02
 * `exactInputSingle`. Never `token.transfer(router, amount)`.
 *
 * Sells always exit to ETH. A missing ETH hop fails instead of paying SPCX.
 */
export function prepareExactInSwap(swap: ExactInSwapBuild): PreparedTx {
  if (swap.side === "sell") {
    return buildSellToEth(swap);
  }

  const nativePay = swap.payNative;
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
  const tx = buildV3Swap({
    tokenIn: swap.quoteToken,
    tokenOut: swap.token,
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
