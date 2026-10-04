import {decodeFunctionData, maxUint160, maxUint256} from "viem";
import {
  PERMIT2,
  QUOTE_ETH,
  QUOTE_USDG,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
} from "./contracts";
import {erc20Abi, encodeApprove, type PreparedTx} from "./swapTx";

/**
 * Paxos USDG `approve` overwrites the current allowance. It does not revert
 * when changing a non-zero allowance to another non-zero value (the USDT
 * `require(!((_value != 0) && (allowed != 0)))` guard). Typical Pons / Long
 * launch tokens are OpenZeppelin ERC-20s and behave the same.
 *
 * Do not add a 0-then-set hop unless a token is proven to need it.
 */
const USDT_STYLE_RESET = new Set<string>([
  // empty — USDG and typical sell tokens do not require a reset
]);

export const APPROVE_GAS_UNITS = 60_000n;
export const SWAP_GAS_UNITS = 400_000n;

export type WalletKind = "embedded" | "imported";
export type TradeSide = "buy" | "sell";
export type SignatureStep = "approve" | "swap";

export function walletKindFrom(importedConnected: boolean): WalletKind {
  return importedConnected ? "imported" : "embedded";
}

/**
 * Token the user must approve to HodlRouter, or null when the path is a
 * native ETH buy (ETH is not ERC-20 — one signature, the swap).
 */
export function approvalSpendToken(opts: {
  side: TradeSide;
  payNative: boolean;
  quoteToken: string;
  token: `0x${string}`;
}): `0x${string}` | null {
  if (opts.side === "buy" && opts.payNative) return null;
  const spend =
    opts.side === "buy" ? opts.quoteToken.toLowerCase() : opts.token.toLowerCase();
  if (spend === QUOTE_ETH) return null;
  if (!/^0x[a-f0-9]{40}$/.test(spend)) return null;
  return spend as `0x${string}`;
}

export function approvalSymbol(opts: {
  side: TradeSide;
  tokenSymbol: string;
  quoteToken: string;
  quoteSymbol?: string;
}): string {
  if (opts.side === "sell") return opts.tokenSymbol || "token";
  const quote = opts.quoteToken.toLowerCase();
  if (quote === QUOTE_USDG) return "USDG";
  if (quote === QUOTE_WETH) return "WETH";
  if (opts.quoteSymbol && opts.quoteSymbol !== "tokens") return opts.quoteSymbol;
  return "token";
}

export function approveButtonLabel(symbol: string): string {
  return `Approve ${symbol}`;
}

export function tradeButtonLabel(side: TradeSide, symbol: string): string {
  return `${side === "buy" ? "Buy" : "Sell"} ${symbol}`;
}

export function allowanceSufficient(current: bigint, needed: bigint): boolean {
  return needed <= 0n || current >= needed;
}

/**
 * Sell (and any ERC-20 spend approve) may start only when the wallet holds
 * the exact token being spent. Buy must not use this against the *output*
 * token — buyers spend ETH/USDG, not the asset they are buying.
 */
export function canStartSellApprove(opts: {
  heldRaw: bigint | null | undefined;
  amountIn: bigint;
}): boolean {
  if (opts.heldRaw == null || opts.heldRaw <= 0n) return false;
  return opts.amountIn > 0n && opts.amountIn <= opts.heldRaw;
}

export function spendBalanceBlockReason(opts: {
  heldRaw: bigint;
  amount: bigint;
  symbol?: string;
}): string | null {
  if (opts.amount <= 0n) return null;
  if (opts.heldRaw <= 0n) {
    const symbol = opts.symbol?.trim();
    return symbol ? `You have 0 ${symbol}` : "You have 0 of this token";
  }
  if (opts.heldRaw < opts.amount) return "Amount exceeds your balance";
  return null;
}

export function sellBalanceBlockReason(opts: {
  side: TradeSide;
  symbol: string;
  heldRaw: bigint | null | undefined;
  amountIn?: bigint;
  amountUsd?: number;
  heldUsd?: number;
}): string | null {
  if (opts.side !== "sell") return null;
  if (opts.heldRaw == null) return null;
  if (opts.heldRaw <= 0n) {
    const symbol = opts.symbol.trim();
    return symbol ? `You have 0 ${symbol}` : "You have 0 of this token";
  }
  if (opts.amountIn != null && opts.amountIn > opts.heldRaw) {
    return "Amount exceeds your balance";
  }
  if (
    opts.heldUsd != null
    && opts.amountUsd != null
    && Number.isFinite(opts.heldUsd)
    && Number.isFinite(opts.amountUsd)
    && opts.amountUsd > opts.heldUsd * 1.001
  ) {
    return "Amount exceeds your balance";
  }
  return null;
}

export function assertSpendCovered(opts: {
  heldRaw: bigint;
  amount: bigint;
  symbol?: string;
}): void {
  const reason = spendBalanceBlockReason(opts);
  if (reason) throw new Error(reason);
}

export function requiresAllowanceReset(token: string): boolean {
  return USDT_STYLE_RESET.has(token.toLowerCase());
}

/**
 * Wallet prompts before an ERC-20 spend through HodlRouter. Approvals are
 * max, once per token: HodlRouter only pulls from msg.sender, and an exact
 * approval was used up by every swap, so each repeat trade asked again.
 */
export type ApprovalStep = "approve-router" | "approve-permit2" | "permit2-allow";

export function hodlApprovalSteps(opts: {allowance: bigint; need: bigint}): ApprovalStep[] {
  return allowanceSufficient(opts.allowance, opts.need) ? [] : ["approve-router"];
}

/**
 * Wallet prompts before an ERC-20 spend through the Universal Router: the
 * token's allowance to Permit2 (max, once), then Permit2's allowance to the
 * router (max uint160, which Permit2 never spends down, re-signed only when
 * it nears expiry). A repeat trade needs neither.
 */
export function permit2ApprovalSteps(opts: {
  tokenAllowance: bigint;
  permit2Amount: bigint;
  permit2Expiration: number | bigint;
  need: bigint;
  nowSec: number;
}): ApprovalStep[] {
  const steps: ApprovalStep[] = [];
  if (!allowanceSufficient(opts.tokenAllowance, opts.need)) steps.push("approve-permit2");
  const fresh = BigInt(opts.permit2Expiration) > BigInt(opts.nowSec + PERMIT2_EXPIRY_MARGIN_SEC);
  if (!fresh || !allowanceSufficient(opts.permit2Amount, opts.need)) steps.push("permit2-allow");
  return steps;
}

/** Re-sign the Permit2 allowance when it has less than this left. */
export const PERMIT2_EXPIRY_MARGIN_SEC = 10 * 60;

export const MAX_TOKEN_APPROVAL = maxUint256;
export const MAX_PERMIT2_APPROVAL = maxUint160;

/** Confirm copy. Embedded never tells someone to leave the app. */
export function pendingSignatureCopy(
  kind: WalletKind,
  step: SignatureStep,
): string {
  if (kind === "embedded") {
    return step === "approve"
      ? "Confirm the approval in this app."
      : "Confirm the swap in this app.";
  }
  return step === "approve"
    ? "Confirm the approval in your wallet app, then return here."
    : "Confirm the swap in your wallet app, then return here.";
}

export function idleSignHint(kind: WalletKind): string {
  return kind === "embedded"
    ? "Confirm in this app. No simulated fill."
    : "Confirm in your wallet app, then return here. No simulated fill.";
}

/**
 * Native wei that must be in the wallet before a 1-tx swap or a 2-tx
 * approve-then-swap. Used to fail upfront on a two-signature path.
 */
export function nativeWeiForPath(opts: {
  txs: 1 | 2;
  gasPrice: bigint;
  nativeValue?: bigint;
}): bigint {
  const units = opts.txs === 2 ? APPROVE_GAS_UNITS + SWAP_GAS_UNITS : SWAP_GAS_UNITS;
  return units * opts.gasPrice + (opts.nativeValue ?? 0n);
}

export function coversNative(balance: bigint, needed: bigint): boolean {
  return balance >= needed;
}

/** approve(HodlRouter, max). Only HodlRouter may be the spender here. */
export function encodeHodlApprove(
  token: `0x${string}`,
  router: `0x${string}`,
): PreparedTx {
  if (router.toLowerCase() === UNIVERSAL_ROUTER || router.toLowerCase() === PERMIT2) {
    throw new Error("Spender must be HodlRouter, not Universal Router or Permit2.");
  }
  return encodeApprove(token, router, MAX_TOKEN_APPROVAL);
}

export function decodedApprove(tx: PreparedTx): {
  spender: `0x${string}`;
  amount: bigint;
} {
  const decoded = decodeFunctionData({abi: erc20Abi, data: tx.data});
  if (decoded.functionName !== "approve") {
    throw new Error("expected approve");
  }
  const [spender, amount] = decoded.args;
  return {spender, amount};
}

/**
 * After an approval confirms, a stale quote is refreshed. Allowance stays;
 * we never restart approve for the same size.
 */
export function shouldRequoteAfterApproval(opts: {
  approved: boolean;
  quoteExpired: boolean;
  allowanceOk: boolean;
}): boolean {
  return opts.approved && opts.quoteExpired && opts.allowanceOk;
}

export function nextTicketAction(opts: {
  allowanceOk: boolean;
  allowancePending: boolean;
  side: TradeSide;
  symbol: string;
  approvalSymbol: string;
}): "checking" | "approve" | "trade" {
  if (opts.allowancePending) return "checking";
  if (!opts.allowanceOk) return "approve";
  return "trade";
}

export function ticketButtonLabel(action: ReturnType<typeof nextTicketAction>, opts: {
  side: TradeSide;
  symbol: string;
  approvalSymbol: string;
}): string {
  if (action === "checking") return "Checking allowance…";
  if (action === "approve") return approveButtonLabel(opts.approvalSymbol);
  return tradeButtonLabel(opts.side, opts.symbol);
}
