import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  toHex,
} from "viem";
import {
  FEE_COLLECTOR,
  PERMIT2,
  QUOTE_ETH,
  QUOTE_USDG,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "./contracts";
import {feeOnAmount, inputAfterBuyFee, PLATFORM_FEE_BPS} from "./venueQuote";
import {CANT_ENTER_FROM_ETH, CANT_EXIT_TO_ETH, isEthish, type SwapHop} from "./swapRoute";
import {
  amountOutMinimum,
  assertSaneUrBuy,
  quotedPairOut,
} from "./tradePolicy";
import {
  encodeV4SwapExactInSingle,
  UR_ADDRESS_THIS,
  UR_COMMAND_V4_SWAP,
  UR_MSG_SENDER,
  type V4PoolKey,
} from "./v4Encoding";

/**
 * A Permit2 allowance for the Universal Router lives 30 minutes: long enough
 * to sign the swap after the approve lands, never a standing allowance.
 */
export const PERMIT2_APPROVAL_TTL_SEC = 30 * 60;

export function permit2Expiry(nowSec: number = Math.floor(Date.now() / 1000)): number {
  return nowSec + PERMIT2_APPROVAL_TTL_SEC;
}

/** Universal Router command: V3 exact-in. */
export const UR_COMMAND_V3_SWAP_EXACT_IN = 0x00;
/** Universal Router command: pull ERC-20 via Permit2 onto the router. */
export const UR_COMMAND_PERMIT2_TRANSFER_FROM = 0x02;
/** Sweep leftover ETH/ERC-20 to a recipient (our 50 bps buy skim). */
export const UR_COMMAND_SWEEP = 0x04;
/** Send an exact amount of a token on the router (our 50 bps USDG buy skim). */
export const UR_COMMAND_TRANSFER = 0x05;
/** Pay a bips portion of a token on the router (our 50 bps sell skim). */
export const UR_COMMAND_PAY_PORTION = 0x06;
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

/**
 * UR `PERMIT2_TRANSFER_FROM` (0x02) is `abi.decode(inputs, (address, address, uint160))`
 * — token, recipient, amount. `(token, amount, recipient)` swaps the last two
 * words: amount is read as the recipient and the recipient address as a huge
 * uint160, so Permit2 tries to pull far more than the wallet holds and
 * reverts TRANSFER_FROM_FAILED.
 */
export function encodePermit2Pull(
  token: `0x${string}`,
  amount: bigint,
  recipient: `0x${string}`,
): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "address"}, {type: "uint160"}],
    [token, recipient, amount],
  );
}

function encodeWrapEth(recipient: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "uint256"}],
    [recipient, amount],
  );
}

function encodeSweep(
  token: `0x${string}`,
  recipient: `0x${string}`,
  amountMin: bigint,
): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "address"}, {type: "uint256"}],
    [token, recipient, amountMin],
  );
}

function encodePayPortion(
  token: `0x${string}`,
  recipient: `0x${string}`,
  bips: number,
): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "address"}, {type: "uint256"}],
    [token, recipient, BigInt(bips)],
  );
}

export function encodeV3Path(
  tokenIn: `0x${string}`,
  fee: number,
  tokenOut: `0x${string}`,
): `0x${string}` {
  return concatHex([tokenIn, toHex(fee, {size: 3}), tokenOut]);
}

/**
 * UR 2.1.1 `V3_SWAP_EXACT_IN` (0x00) is `abi.decode(inputs, (address,
 * uint256, uint256, bytes, bool, uint256[]))` — the trailing `maxHopSlippage`
 * array is new in 2.1. Leaving it off makes the router read the path length
 * as the array offset and revert `SliceOutOfBounds()`, which is what broke
 * every ETH → USDG → stock → token buy and its sell back. Empty = no per-hop
 * check; `amountOutMinimum` still guards the trade.
 */
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
      {type: "uint256[]"},
    ],
    [
      opts.recipient,
      opts.amountIn,
      opts.amountOutMinimum,
      encodeV3Path(opts.tokenIn, opts.fee, opts.tokenOut),
      opts.payerIsUser,
      [], // maxHopSlippage
    ],
  );
}

function encodeTransferOnRouter(
  token: `0x${string}`,
  recipient: `0x${string}`,
  amount: bigint,
): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "address"}, {type: "uint256"}],
    [token, recipient, amount],
  );
}

/**
 * Native ETH and WETH are different currencies to a pool. When one hop pays
 * out the form the next hop does not take (a native-ETH V4 pool into the
 * WETH/USDG book, or back), convert everything the router holds in between.
 */
function bridgeEthForm(
  prevOut: `0x${string}`,
  nextIn: `0x${string}`,
): {command: number; input: `0x${string}`} | null {
  const from = prevOut.toLowerCase();
  const to = nextIn.toLowerCase();
  if (from === QUOTE_ETH && to === QUOTE_WETH) {
    return {command: UR_COMMAND_WRAP_ETH, input: encodeWrapEth(UR_ADDRESS_THIS, UR_CONTRACT_BALANCE)};
  }
  if (from === QUOTE_WETH && to === QUOTE_ETH) {
    return {command: UR_COMMAND_UNWRAP_WETH, input: encodeUnwrapWeth(UR_ADDRESS_THIS, 0n)};
  }
  return null;
}

function encodeUnwrapWeth(recipient: `0x${string}`, amountMin: bigint): `0x${string}` {
  return encodeAbiParameters(
    [{type: "address"}, {type: "uint256"}],
    [recipient, amountMin],
  );
}

/** Exact-amount ERC-20 approve. There is no unlimited default. */
export function encodeApprove(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
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
    throw new Error("Trade must be a swap, not an ERC-20 transfer to the router.");
  }
  if (tx.to.toLowerCase() !== UNIVERSAL_ROUTER) {
    throw new Error("Swap must target the Universal Router.");
  }
}

/**
 * Permit2 allowance for exactly this trade, expiring at `expiration`
 * (see `permit2Expiry`). Never max, never open-ended.
 */
export function encodePermit2Approve(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  expiration: number,
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
  /** true = SETTLE_ALL / msg.value. false = tokens already on the router. */
  payerIsUser?: boolean;
  /** Prior hop left this currency on the router — settle balance, not a quote. */
  fromRouterBalance?: boolean;
}): `0x${string}` {
  if (opts.hop.venue === "v4") {
    if (!opts.hop.poolKey) {
      throw new Error("No Uniswap pool for this token.");
    }
    return encodeV4SwapExactInSingle({
      poolKey: opts.hop.poolKey,
      zeroForOne: Boolean(opts.hop.zeroForOne),
      amountIn: opts.amountIn,
      amountOutMinimum: opts.amountOutMinimum,
      // Default false: Permit2 or WRAP_ETH already put tokens on UR.
      // Native ETH first hop passes true so SETTLE_ALL takes msg.value.
      payerIsUser: opts.fromRouterBalance
        ? false
        : opts.payerIsUser === true
          ? undefined
          : false,
      fromRouterBalance: opts.fromRouterBalance,
      takeToRouter: opts.takeToRouter,
    }).inputs[0];
  }
  if (opts.hop.v3Fee == null) {
    throw new Error("No Uniswap pool for this token.");
  }
  return encodeV3ExactIn({
    recipient: opts.takeToRouter ? UR_ADDRESS_THIS : UR_MSG_SENDER,
    amountIn: opts.amountIn,
    amountOutMinimum: opts.amountOutMinimum,
    tokenIn: opts.hop.tokenIn,
    tokenOut: opts.hop.tokenOut,
    fee: opts.hop.v3Fee,
    payerIsUser: false,
  });
}

/**
 * Sell path: token → … → ETH or USDG via Universal Router. A WETH payout is
 * unwrapped to ETH. The 50 bps fee is paid from the output before the seller
 * is swept the rest. Never leaves the user in SPCX or a stock token.
 */
export function buildSellToEth(swap: ExactInSwapBuild): PreparedTx {
  const hops = hopsForSwap(swap);
  const tokenOut = (hops.length > 0 ? hops[hops.length - 1].tokenOut : swap.quoteToken).toLowerCase();
  const toUsdg = tokenOut === QUOTE_USDG;
  if (hops.length === 0 || (!isEthish(tokenOut) && !toUsdg)) {
    throw new Error(CANT_EXIT_TO_ETH);
  }
  const unwrap = tokenOut === QUOTE_WETH;
  const commands: number[] = [UR_COMMAND_PERMIT2_TRANSFER_FROM];
  const inputs: `0x${string}`[] = [
    encodePermit2Pull(swap.token, swap.amountIn, UNIVERSAL_ROUTER),
  ];

  const userMin = inputAfterBuyFee(swap.amountOutMinimum, PLATFORM_FEE_BPS);

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const bridge = i > 0 ? bridgeEthForm(hops[i - 1].tokenOut, hop.tokenIn) : null;
    if (bridge) {
      commands.push(bridge.command);
      inputs.push(bridge.input);
    }
    const takeToRouter = true;
    const fromRouterBalance = i > 0 && hop.venue === "v4";
    const amountIn =
      i === 0
        ? swap.amountIn
        : hop.venue === "v3"
          ? UR_CONTRACT_BALANCE
          : fromRouterBalance
            ? 0n
            : BigInt(hop.amountIn ?? "0");
    if (i > 0 && hop.venue === "v4" && !fromRouterBalance && amountIn <= 0n) {
      throw new Error(CANT_EXIT_TO_ETH);
    }
    commands.push(hop.venue === "v4" ? UR_COMMAND_V4_SWAP : UR_COMMAND_V3_SWAP_EXACT_IN);
    inputs.push(
      encodeHopInput({
        hop,
        amountIn,
        amountOutMinimum: 0n,
        takeToRouter,
        fromRouterBalance,
      }),
    );
  }

  const outToken = toUsdg ? QUOTE_USDG : unwrap ? QUOTE_WETH : QUOTE_ETH;
  commands.push(UR_COMMAND_PAY_PORTION);
  inputs.push(encodePayPortion(outToken, FEE_COLLECTOR, PLATFORM_FEE_BPS));

  if (unwrap) {
    commands.push(UR_COMMAND_UNWRAP_WETH);
    inputs.push(encodeUnwrapWeth(UR_MSG_SENDER, userMin));
  } else {
    commands.push(UR_COMMAND_SWEEP);
    inputs.push(encodeSweep(outToken, UR_MSG_SENDER, userMin));
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
 * Buy path: ETH → token, or ETH → pair → token, via Universal Router. The
 * 50 bps fee stays on the router and is swept to FeeCollector, single hop or
 * not. Never `token.transfer(router)` and never asks the user to hold SPY/SPCX.
 */
export function buildBuyFromEth(swap: ExactInSwapBuild): PreparedTx {
  const hops = hopsForSwap(swap);
  if (hops.length === 0) {
    throw new Error("No Uniswap pool for this token.");
  }
  assertSaneUrBuy({
    amountIn: swap.amountIn,
    amountOutMinimum: swap.amountOutMinimum,
    hops,
  });
  const firstIn = hops[0].tokenIn.toLowerCase();
  const wrap = firstIn === QUOTE_WETH;
  const nativeFirst = firstIn === QUOTE_ETH;
  if (!wrap && !nativeFirst) {
    throw new Error(CANT_ENTER_FROM_ETH);
  }
  const pairMinOut = amountOutMinimum(quotedPairOut(hops), 5);
  const feeAmount = feeOnAmount(swap.amountIn);
  const swapIn = inputAfterBuyFee(swap.amountIn);
  if (swapIn <= 0n) {
    throw new Error(CANT_ENTER_FROM_ETH);
  }

  const commands: number[] = [];
  const inputs: `0x${string}`[] = [];
  if (wrap) {
    commands.push(UR_COMMAND_WRAP_ETH);
    inputs.push(encodeWrapEth(UNIVERSAL_ROUTER, swapIn));
  }

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const last = i === hops.length - 1;
    const bridge = i > 0 ? bridgeEthForm(hops[i - 1].tokenOut, hop.tokenIn) : null;
    if (bridge) {
      commands.push(bridge.command);
      inputs.push(bridge.input);
    }
    const fromRouterBalance = i > 0 && hop.venue === "v4";
    const amountIn =
      i === 0
        ? swapIn
        : hop.venue === "v3"
          ? UR_CONTRACT_BALANCE
          : fromRouterBalance
            ? 0n
            : BigInt(hop.amountIn ?? "0");
    if (i > 0 && hop.venue === "v4" && !fromRouterBalance && amountIn <= 0n) {
      throw new Error(CANT_ENTER_FROM_ETH);
    }
    commands.push(hop.venue === "v4" ? UR_COMMAND_V4_SWAP : UR_COMMAND_V3_SWAP_EXACT_IN);
    inputs.push(
      encodeHopInput({
        hop,
        amountIn,
        amountOutMinimum: last
          ? swap.amountOutMinimum
          : i === hops.length - 2
            ? pairMinOut
            : 0n,
        takeToRouter: !last,
        // Native ETH already sits on UR from msg.value. Settle swapIn only
        // so the 50 bps leftover can be swept to FeeCollector.
        payerIsUser: false,
        fromRouterBalance,
      }),
    );
  }

  if (feeAmount > 0n) {
    commands.push(UR_COMMAND_SWEEP);
    inputs.push(encodeSweep(QUOTE_ETH, FEE_COLLECTOR, feeAmount));
  }

  const tx: PreparedTx = {
    to: UNIVERSAL_ROUTER,
    data: encodeUrExecute(packCommands(commands), inputs, swap.deadline),
    value: swap.amountIn,
  };
  assertSwapNotErc20Transfer(tx);
  return tx;
}

/**
 * Buy path paid in an ERC-20 (USDG): USDG → token, or USDG → pair → token,
 * via Universal Router. Permit2 pulls the whole input onto the router, the
 * exact 50 bps fee goes to FeeCollector, and the rest is swapped.
 */
export function buildBuyFromToken(swap: ExactInSwapBuild): PreparedTx {
  const hops = hopsForSwap(swap);
  if (hops.length === 0) {
    throw new Error("No Uniswap pool for this token.");
  }
  const payToken = hops[0].tokenIn.toLowerCase() as `0x${string}`;
  if (isEthish(payToken)) {
    throw new Error("This route pays ETH, not a token.");
  }
  assertSaneUrBuy({
    amountIn: swap.amountIn,
    amountOutMinimum: swap.amountOutMinimum,
    hops,
  });
  const pairMinOut = amountOutMinimum(quotedPairOut(hops), 5);
  const feeAmount = feeOnAmount(swap.amountIn);
  const swapIn = inputAfterBuyFee(swap.amountIn);
  if (swapIn <= 0n) {
    throw new Error("No Uniswap pool for this token.");
  }

  const commands: number[] = [UR_COMMAND_PERMIT2_TRANSFER_FROM];
  const inputs: `0x${string}`[] = [
    encodePermit2Pull(payToken, swap.amountIn, UNIVERSAL_ROUTER),
  ];
  if (feeAmount > 0n) {
    commands.push(UR_COMMAND_TRANSFER);
    inputs.push(encodeTransferOnRouter(payToken, FEE_COLLECTOR, feeAmount));
  }

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const last = i === hops.length - 1;
    const bridge = i > 0 ? bridgeEthForm(hops[i - 1].tokenOut, hop.tokenIn) : null;
    if (bridge) {
      commands.push(bridge.command);
      inputs.push(bridge.input);
    }
    const fromRouterBalance = i > 0 && hop.venue === "v4";
    const amountIn =
      i === 0
        ? swapIn
        : hop.venue === "v3"
          ? UR_CONTRACT_BALANCE
          : fromRouterBalance
            ? 0n
            : BigInt(hop.amountIn ?? "0");
    commands.push(hop.venue === "v4" ? UR_COMMAND_V4_SWAP : UR_COMMAND_V3_SWAP_EXACT_IN);
    inputs.push(
      encodeHopInput({
        hop,
        amountIn,
        amountOutMinimum: last
          ? swap.amountOutMinimum
          : i === hops.length - 2
            ? pairMinOut
            : 0n,
        takeToRouter: !last,
        // The input sits on the router after the Permit2 pull.
        payerIsUser: false,
        fromRouterBalance,
      }),
    );
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
 * Value-moving swap the ticket signs. Always UR `execute`, and every route
 * pays the 50 bps platform fee. Never `token.transfer(router, amount)`.
 *
 * Sells exit to ETH or USDG. A missing exit hop fails instead of paying SPCX.
 * Buys pay ETH or USDG; a token without a pool in that currency hops through
 * its own pair (ETH → USDG → FIG, USDG → WETH → ORBIO, ETH → pair → token).
 */
export function prepareExactInSwap(swap: ExactInSwapBuild): PreparedTx {
  if (swap.side === "sell") {
    return buildSellToEth(swap);
  }
  assertSaneUrBuy({
    amountIn: swap.amountIn,
    amountOutMinimum: swap.amountOutMinimum,
    hops: swap.hops,
  });
  return swap.payNative ? buildBuyFromEth(swap) : buildBuyFromToken(swap);
}

export function isNativeQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_ETH;
}

export function isWethQuote(token: string): boolean {
  return token.toLowerCase() === QUOTE_WETH;
}

export {PERMIT2, UNIVERSAL_ROUTER};
