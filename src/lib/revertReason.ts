import {decodeErrorResult, hexToString, parseAbi} from "viem";

const REVERT_ERRORS = parseAbi([
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
  "error InvalidNonce()",
  "error ExcessiveInvalidation()",
  "error TooLittleReceived()",
  "error V4TooLittleReceived()",
  "error InsufficientOutputAmount()",
  "error TransactionDeadlinePassed()",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error STF()",
  "error TransferFromFailed()",
  "error FromAddressIsNotOwner()",
  "error CurrencyNotSettled()",
  "error DeltaNotPositive(address currency)",
  "error DeltaNotNegative(address currency)",
  "error PoolNotInitialized()",
  "error NotEnoughLiquidity()",
  "error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)",
  "error PriceLimitOutOfBounds(uint160 sqrtPriceLimitX96)",
  "error Dust()",
  "error Cap()",
  "error PausedError()",
  "error BadHook()",
  "error BadPool()",
  "error BadFeeTier()",
  "error BadPair()",
  "error NothingSupplied()",
  "error InsufficientOut()",
  // v1 HodlRouter. v2 names the token: different selector, same meaning.
  "error Leftover()",
  "error Leftover(address token)",
  "error DeadlineExpired()",
  // HodlRouter v2 (PR #62).
  "error FeeOnTransferToken()",
  "error UnexpectedEth()",
  "error EthTransferFailed()",
  "error TokenCallFailed()",
  "error BalanceQueryFailed()",
  "error SafeCastOverflow()",
]);

export type TradeFailure = Error & {txHash?: `0x${string}`};

/** Hex revert payload nested in a viem / RPC error. */
export function revertDataFromUnknown(error: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    if (typeof cur === "string" && /^0x[0-9a-fA-F]{8,}$/.test(cur)) {
      return cur as `0x${string}`;
    }
    if (typeof cur !== "object") continue;
    const row = cur as Record<string, unknown>;
    for (const key of ["data", "raw", "hex"]) {
      const value = row[key];
      if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) {
        return value as `0x${string}`;
      }
      if (value && typeof value === "object") stack.push(value);
    }
    if (typeof row.walk === "function") {
      try {
        stack.push(row.walk());
      } catch {
        // ignore
      }
    }
    if (row.cause) stack.push(row.cause);
    if (typeof row.details === "string" && /0x[0-9a-fA-F]{8,}/.test(row.details)) {
      const match = row.details.match(/0x[0-9a-fA-F]{8,}/);
      if (match) return match[0] as `0x${string}`;
    }
  }
  return null;
}

function decodeErrorString(data: `0x${string}`): string | null {
  if (!data.startsWith("0x08c379a0") || data.length < 138) return null;
  try {
    const offset = Number(BigInt(`0x${data.slice(10, 74)}`));
    const start = 10 + offset * 2;
    const len = Number(BigInt(`0x${data.slice(start, start + 64)}`));
    const hex = data.slice(start + 64, start + 64 + len * 2);
    const text = hexToString(`0x${hex}`).replace(/\0+$/g, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function decodeRevertHex(data: string): {name: string; text: string} | null {
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length < 10) return null;
  const hex = data as `0x${string}`;
  const asString = decodeErrorString(hex);
  if (asString) return {name: "Error", text: asString};
  try {
    const decoded = decodeErrorResult({abi: REVERT_ERRORS, data: hex});
    if (decoded.errorName === "ExecutionFailed") {
      const inner = decoded.args[1];
      if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
        const nested = decodeRevertHex(inner);
        if (nested) return nested;
      }
      return {name: "ExecutionFailed", text: "ExecutionFailed"};
    }
    return {name: decoded.errorName, text: decoded.errorName};
  } catch {
    return {name: hex.slice(0, 10), text: hex.slice(0, 10)};
  }
}

/**
 * User-facing revert copy. Null when we only have a generic "execution reverted".
 */
export function formatRevertForUser(error: unknown): string | null {
  const data = revertDataFromUnknown(error);
  const decoded = data ? decodeRevertHex(data) : null;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = decoded?.name ?? "";
  const blob = `${name} ${decoded?.text ?? ""} ${message}`;

  if (/AllowanceExpired|InsufficientAllowance/i.test(blob)) {
    return "Permit2 is not approved for this token. Approve, then sell.";
  }
  if (/TooLittleReceived|InsufficientOutputAmount|InsufficientOut|V4TooLittleReceived/i.test(blob)) {
    return "Price moved past your slippage. Try a smaller size or more slippage.";
  }
  if (/TransactionDeadlinePassed|DeadlineExpired/i.test(blob)) {
    return "The quote expired. Wait for a refresh and try again.";
  }
  if (/\bDust\b/i.test(blob)) {
    return "Trade is below the $1 minimum.";
  }
  if (/\bCap\b|maxNotional/i.test(blob)) {
    return "This size is above the current notional cap.";
  }
  if (/PausedError|\bPaused\b/i.test(blob)) {
    return "Trading is paused.";
  }
  if (/BadHook|BadPool|BadFeeTier|BadPair/i.test(blob)) {
    return "No liquidity on this route.";
  }
  if (/FeeOnTransferToken/i.test(blob)) {
    return "This token charges a tax on every transfer, which HODL's router can't trade.";
  }
  if (/\bLeftover\b|NothingSupplied|UnexpectedEth|EthTransferFailed|TokenCallFailed|BalanceQueryFailed/i.test(blob)) {
    return "The swap path could not settle. Try again.";
  }
  if (/\bSTF\b|TransferFromFailed|TRANSFER_FROM_FAILED|transfer from failed|FromAddressIsNotOwner/i.test(blob)) {
    return "Token transfer failed. Approve the token, then try again.";
  }
  if (/CurrencyNotSettled|DeltaNotPositive|DeltaNotNegative/i.test(blob)) {
    return "The swap path could not settle. Try again.";
  }
  if (/PoolNotInitialized|NotEnoughLiquidity|no liquidity|NoPool/i.test(blob)) {
    return "No liquidity on this route.";
  }
  if (decoded?.name === "Error" && decoded.text) {
    return decoded.text.slice(0, 180);
  }
  if (decoded && decoded.name.startsWith("0x") && decoded.name.length === 10) {
    return `Swap reverted (${decoded.name}).`;
  }
  if (decoded && decoded.name !== "ExecutionFailed") {
    return `Swap reverted: ${decoded.name}.`;
  }
  return null;
}

export function isContractRevert(error: unknown): boolean {
  return revertDataFromUnknown(error) != null;
}

export function tradeHashFromError(error: unknown): `0x${string}` | null {
  if (!error || typeof error !== "object") return null;
  const hash = (error as {txHash?: unknown}).txHash;
  return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)
    ? (hash as `0x${string}`)
    : null;
}

export function asTradeFailure(error: unknown, hash?: `0x${string}`): TradeFailure {
  const formatted = formatRevertForUser(error);
  const base =
    error instanceof Error ? error : new Error(formatted || String(error || "The swap could not be sent."));
  if (formatted && base.message !== formatted) {
    base.message = formatted;
  }
  if (hash) (base as TradeFailure).txHash = hash;
  return base as TradeFailure;
}

export async function waitForTradeReceipt(opts: {
  hash: `0x${string}`;
  publicClient?: {
    waitForTransactionReceipt: (args: {hash: `0x${string}`}) => Promise<{
      status: string;
      blockNumber?: bigint;
    }>;
    getTransaction: (args: {hash: `0x${string}`}) => Promise<{
      to: `0x${string}` | null;
      input: `0x${string}`;
      from: `0x${string}`;
      value: bigint;
      gas: bigint;
      blockNumber?: bigint | null;
    }>;
    call: (args: {
      to?: `0x${string}`;
      data?: `0x${string}`;
      account?: `0x${string}`;
      value?: bigint;
      gas?: bigint;
      blockNumber?: bigint;
    }) => Promise<unknown>;
  } | null;
}): Promise<void> {
  if (!opts.publicClient) return;
  const receipt = await opts.publicClient.waitForTransactionReceipt({hash: opts.hash});
  if (receipt.status !== "reverted") return;
  try {
    const tx = await opts.publicClient.getTransaction({hash: opts.hash});
    await opts.publicClient.call({
      to: tx.to ?? undefined,
      data: tx.input,
      account: tx.from,
      value: tx.value,
      gas: tx.gas,
      blockNumber: tx.blockNumber ?? receipt.blockNumber,
    });
  } catch (error) {
    throw asTradeFailure(error, opts.hash);
  }
  throw asTradeFailure(new Error("The transaction reverted on chain."), opts.hash);
}
