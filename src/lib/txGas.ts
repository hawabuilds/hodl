import {toHex} from "viem";
import {RH_MAINNET_ID} from "@/config/chain";
import {APPROVE_GAS_UNITS, SWAP_GAS_UNITS} from "./approvalFlow";
import {asTradeFailure, isContractRevert} from "./revertReason";
import type {PreparedTx} from "./swapTx";

/** Intrinsic cost of a simple ETH transfer. Contract calls with calldata are higher. */
export const INTRINSIC_TX_GAS = 21_000n;
const GAS_BUFFER_BPS = 2_000n;
const MIN_CONTRACT_GAS = 50_000n;
const APPROVE_SELECTOR = "0x095ea7b3";

export type TxFeeFields = {
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export type GasEstimator = (args: {
  account: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}) => Promise<bigint>;

export type FeeReader = {
  estimateFeesPerGas?: () => Promise<{
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }>;
  getGasPrice?: () => Promise<bigint>;
};

/** ERC-20 approve vs HodlRouter / Universal Router / SwapRouter02. */
export function fallbackGasForTx(tx: PreparedTx): bigint {
  return tx.data.startsWith(APPROVE_SELECTOR) ? APPROVE_GAS_UNITS : SWAP_GAS_UNITS;
}

/**
 * Gas limit for a contract call. Never 0 or 21000 — those fail with
 * "intrinsic gas too low" once calldata is attached.
 */
export function resolveTxGasLimit(
  estimate: bigint | null | undefined,
  fallback: bigint = SWAP_GAS_UNITS,
): bigint {
  const safeFallback = fallback > INTRINSIC_TX_GAS ? fallback : SWAP_GAS_UNITS;
  if (estimate == null || estimate <= INTRINSIC_TX_GAS) return safeFallback;
  const buffered = estimate + (estimate * GAS_BUFFER_BPS) / 10_000n;
  return buffered < MIN_CONTRACT_GAS ? safeFallback : buffered;
}

export function assertContractGas(gas: bigint, fallback: bigint = SWAP_GAS_UNITS): bigint {
  if (gas === 0n || gas <= INTRINSIC_TX_GAS) {
    return fallback > INTRINSIC_TX_GAS ? fallback : SWAP_GAS_UNITS;
  }
  return gas;
}

export async function estimatePreparedGas(opts: {
  tx: PreparedTx;
  account: `0x${string}` | null;
  estimateGas?: GasEstimator;
  fallback?: bigint;
}): Promise<bigint> {
  const fallback = opts.fallback ?? fallbackGasForTx(opts.tx);
  if (!opts.account || !opts.estimateGas) {
    return resolveTxGasLimit(null, fallback);
  }
  try {
    const estimated = await opts.estimateGas({
      account: opts.account,
      to: opts.tx.to,
      data: opts.tx.data,
      value: opts.tx.value,
    });
    return resolveTxGasLimit(estimated, fallback);
  } catch (error) {
    if (isContractRevert(error)) {
      throw asTradeFailure(error);
    }
    return resolveTxGasLimit(null, fallback);
  }
}

export function hasTxFeeFields(fees?: TxFeeFields | null): boolean {
  if (!fees) return false;
  if (fees.maxFeePerGas && fees.maxFeePerGas > 0n && fees.maxPriorityFeePerGas != null) {
    return true;
  }
  return Boolean(fees.gasPrice && fees.gasPrice > 0n);
}

export function attachTxFeeFields<T extends Record<string, unknown>>(
  base: T,
  fees?: TxFeeFields | null,
): T & TxFeeFields {
  if (fees?.maxFeePerGas && fees.maxFeePerGas > 0n && fees.maxPriorityFeePerGas != null) {
    return {
      ...base,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  }
  if (fees?.gasPrice && fees.gasPrice > 0n) {
    return {...base, gasPrice: fees.gasPrice};
  }
  return base;
}

export async function readTxFeeFields(reader?: FeeReader | null): Promise<TxFeeFields> {
  if (!reader) return {};
  try {
    if (reader.estimateFeesPerGas) {
      const fees = await reader.estimateFeesPerGas();
      if (fees.maxFeePerGas && fees.maxFeePerGas > 0n && fees.maxPriorityFeePerGas != null) {
        return {
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        };
      }
    }
  } catch {
    // Robinhood 4663 may not expose EIP-1559; try legacy gasPrice.
  }
  try {
    if (reader.getGasPrice) {
      const gasPrice = await reader.getGasPrice();
      if (gasPrice > 0n) return {gasPrice};
    }
  } catch {
    // Wallet can still fill fees; the required field is gas limit.
  }
  return {};
}

export interface RpcTxRequest {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  gas: `0x${string}`;
  /** Privy confirmation UI reads this; EIP-1193 uses `gas`. Send both. */
  gasLimit: `0x${string}`;
  chainId: `0x${string}`;
  gasPrice?: `0x${string}`;
  maxFeePerGas?: `0x${string}`;
  maxPriorityFeePerGas?: `0x${string}`;
}

/**
 * Fields Privy's `sendTransaction` / confirmation sheet need to render
 * "Estimated fee" (gas × gas price) on Robinhood 4663.
 */
export type PrivyUnsignedTx = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  chainId: number;
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export function privyUnsignedTx(opts: {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  gas: bigint;
  fees?: TxFeeFields;
  chainId?: number;
}): PrivyUnsignedTx {
  const gas = assertContractGas(opts.gas, fallbackGasForTx({
    to: opts.to,
    data: opts.data,
    value: opts.value,
  }));
  return attachTxFeeFields({
    to: opts.to,
    data: opts.data,
    value: opts.value,
    chainId: opts.chainId ?? RH_MAINNET_ID,
    gasLimit: gas,
  }, opts.fees);
}

export function rpcTxRequest(opts: {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  gas: bigint;
  fees?: TxFeeFields;
  chainId?: number;
}): RpcTxRequest {
  const privy = privyUnsignedTx(opts);
  const req: RpcTxRequest = {
    from: opts.from,
    to: privy.to,
    data: privy.data,
    value: toHex(privy.value),
    gas: toHex(privy.gasLimit),
    gasLimit: toHex(privy.gasLimit),
    chainId: toHex(privy.chainId),
  };
  if (privy.maxFeePerGas && privy.maxPriorityFeePerGas != null) {
    req.maxFeePerGas = toHex(privy.maxFeePerGas);
    req.maxPriorityFeePerGas = toHex(privy.maxPriorityFeePerGas);
  } else if (privy.gasPrice && privy.gasPrice > 0n) {
    req.gasPrice = toHex(privy.gasPrice);
  }
  return req;
}
