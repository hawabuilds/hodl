import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {APPROVE_GAS_UNITS, SWAP_GAS_UNITS, encodeHodlApprove} from "../src/lib/approvalFlow";
import {encodeHodlSell} from "../src/lib/hodlRouter";
import {RH_MAINNET_ID} from "../src/config/chain";
import {
  INTRINSIC_TX_GAS,
  assertContractGas,
  attachTxFeeFields,
  estimatePreparedGas,
  fallbackGasForTx,
  hasTxFeeFields,
  privyUnsignedTx,
  readTxFeeFields,
  resolveTxGasLimit,
  rpcTxRequest,
} from "../src/lib/txGas";

const ROUTER = "0x50cb78e0034b4869d8d42ad901c614866f5c5e99" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const sellTx = encodeHodlSell({
  router: ROUTER,
  tokenIn: TOKEN,
  amountIn: 1_000_000n,
  tokenOut: ZERO,
  minAmountOut: 1n,
  hint: {
    currency0: ZERO,
    currency1: TOKEN,
    fee: 3000,
    tickSpacing: 0,
    hooks: ZERO,
  },
  deadline: 1n,
});

const approveTx = encodeHodlApprove(TOKEN, ROUTER, 1_000_000n);

describe("tx gas limits", () => {
  it("never sends 0 or 21000 for a contract call", () => {
    assert.equal(resolveTxGasLimit(0n), SWAP_GAS_UNITS);
    assert.equal(resolveTxGasLimit(undefined), SWAP_GAS_UNITS);
    assert.equal(resolveTxGasLimit(null), SWAP_GAS_UNITS);
    assert.equal(resolveTxGasLimit(INTRINSIC_TX_GAS), SWAP_GAS_UNITS);
    assert.equal(assertContractGas(0n), SWAP_GAS_UNITS);
    assert.equal(assertContractGas(21_000n), SWAP_GAS_UNITS);
    assert.notEqual(resolveTxGasLimit(0n), 0n);
    assert.ok(resolveTxGasLimit(0n) > INTRINSIC_TX_GAS);
  });

  it("pads a real estimate by 20% and keeps approve vs swap fallbacks", () => {
    assert.equal(resolveTxGasLimit(200_000n), 240_000n);
    assert.equal(fallbackGasForTx(approveTx), APPROVE_GAS_UNITS);
    assert.equal(fallbackGasForTx(sellTx), SWAP_GAS_UNITS);
    assert.ok(APPROVE_GAS_UNITS > INTRINSIC_TX_GAS);
    assert.ok(SWAP_GAS_UNITS > INTRINSIC_TX_GAS);
  });

  it("uses the swap fallback when estimateGas throws a transport error", async () => {
    const gas = await estimatePreparedGas({
      tx: sellTx,
      account: WALLET,
      estimateGas: async () => {
        throw new Error("fetch failed");
      },
    });
    assert.equal(gas, SWAP_GAS_UNITS);
  });

  it("does not send when estimateGas reverts on-chain", async () => {
    await assert.rejects(
      () =>
        estimatePreparedGas({
          tx: sellTx,
          account: WALLET,
          estimateGas: async () => {
            const error = new Error("execution reverted");
            (error as unknown as {data: string}).data =
              "0xd81b2f2e0000000000000000000000000000000000000000000000000000000000000000";
            throw error;
          },
        }),
      /Permit2 is not approved/i,
    );
  });

  it("writes hex gas on the Privy payload and value 0 on a token sell", () => {
    assert.equal(sellTx.value, 0n);
    const req = rpcTxRequest({
      from: WALLET,
      to: sellTx.to,
      data: sellTx.data,
      value: sellTx.value,
      gas: 0n,
      fees: {gasPrice: 1_000_000n},
    });
    assert.equal(req.value, "0x0");
    assert.equal(req.gas, `0x${SWAP_GAS_UNITS.toString(16)}`);
    assert.equal(req.gasLimit, req.gas);
    assert.equal(req.chainId, `0x${RH_MAINNET_ID.toString(16)}`);
    assert.notEqual(req.gas, "0x0");
    assert.notEqual(req.gas, "0x5208");
    assert.equal(req.gasPrice, "0xf4240");
    assert.ok(BigInt(req.gas) > INTRINSIC_TX_GAS);
  });

  it("prefers EIP-1559 fees when the chain reports them", async () => {
    const fees = await readTxFeeFields({
      estimateFeesPerGas: async () => ({
        maxFeePerGas: 2_000n,
        maxPriorityFeePerGas: 100n,
      }),
      getGasPrice: async () => 9_999n,
    });
    assert.equal(fees.maxFeePerGas, 2_000n);
    assert.equal(fees.maxPriorityFeePerGas, 100n);
    assert.equal(fees.gasPrice, undefined);
  });

  it("maps gas + fees onto the Privy unsigned request Privy needs for Estimated fee", () => {
    const privy = privyUnsignedTx({
      to: sellTx.to,
      data: sellTx.data,
      value: sellTx.value,
      gas: 200_000n,
      fees: {gasPrice: 1_000_000n},
    });
    assert.equal(privy.chainId, RH_MAINNET_ID);
    assert.equal(privy.gasLimit, 200_000n);
    assert.equal(privy.gasPrice, 1_000_000n);
    assert.equal(privy.maxFeePerGas, undefined);
    assert.ok(hasTxFeeFields(privy));

    const eip1559 = attachTxFeeFields(
      {to: sellTx.to},
      {maxFeePerGas: 3_000n, maxPriorityFeePerGas: 100n},
    );
    assert.equal(eip1559.maxFeePerGas, 3_000n);
    assert.equal(eip1559.maxPriorityFeePerGas, 100n);
    assert.equal(eip1559.gasPrice, undefined);

    const eipReq = rpcTxRequest({
      from: WALLET,
      to: sellTx.to,
      data: sellTx.data,
      value: 0n,
      gas: 200_000n,
      fees: {maxFeePerGas: 3_000n, maxPriorityFeePerGas: 100n},
    });
    assert.equal(eipReq.maxFeePerGas, "0xbb8");
    assert.equal(eipReq.maxPriorityFeePerGas, "0x64");
    assert.equal(eipReq.gasPrice, undefined);
    assert.equal(eipReq.gasLimit, "0x30d40");
  });
});
