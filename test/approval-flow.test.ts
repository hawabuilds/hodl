import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {maxUint256} from "viem";
import {
  PERMIT2,
  QUOTE_ETH,
  QUOTE_USDG,
  UNIVERSAL_ROUTER,
} from "../src/lib/contracts";
import {
  allowanceSufficient,
  approvalSpendToken,
  approvalSymbol,
  approveButtonLabel,
  coversNative,
  decodedApprove,
  encodeHodlApprove,
  idleSignHint,
  isExactApproveAmount,
  nativeWeiForPath,
  nextTicketAction,
  pendingSignatureCopy,
  requiresAllowanceReset,
  shouldRequoteAfterApproval,
  ticketButtonLabel,
  tradeButtonLabel,
  walletKindFrom,
} from "../src/lib/approvalFlow";

const ROUTER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const AMOUNT = 1_000_000n;

describe("approval spend paths", () => {
  it("skips approval on a native ETH buy", () => {
    assert.equal(
      approvalSpendToken({
        side: "buy",
        payNative: true,
        quoteToken: QUOTE_ETH,
        token: TOKEN,
      }),
      null,
    );
    assert.equal(
      nextTicketAction({
        allowanceOk: true,
        allowancePending: false,
        side: "buy",
        symbol: "PEPE",
        approvalSymbol: "USDG",
      }),
      "trade",
    );
    assert.equal(tradeButtonLabel("buy", "PEPE"), "Buy PEPE");
  });

  it("asks for USDG approval on a USDG buy when allowance is short", () => {
    const spend = approvalSpendToken({
      side: "buy",
      payNative: false,
      quoteToken: QUOTE_USDG,
      token: TOKEN,
    });
    assert.equal(spend, QUOTE_USDG);
    assert.equal(approvalSymbol({side: "buy", tokenSymbol: "PEPE", quoteToken: QUOTE_USDG}), "USDG");
    assert.equal(approveButtonLabel("USDG"), "Approve USDG");
    assert.equal(allowanceSufficient(0n, AMOUNT), false);
    assert.equal(
      ticketButtonLabel("approve", {side: "buy", symbol: "PEPE", approvalSymbol: "USDG"}),
      "Approve USDG",
    );
  });

  it("skips a second approve when allowance already covers the size", () => {
    assert.equal(allowanceSufficient(AMOUNT, AMOUNT), true);
    assert.equal(allowanceSufficient(AMOUNT + 1n, AMOUNT), true);
    assert.equal(
      nextTicketAction({
        allowanceOk: true,
        allowancePending: false,
        side: "buy",
        symbol: "PEPE",
        approvalSymbol: "USDG",
      }),
      "trade",
    );
    assert.equal(
      ticketButtonLabel("trade", {side: "buy", symbol: "PEPE", approvalSymbol: "USDG"}),
      "Buy PEPE",
    );
  });

  it("asks to approve the sold token", () => {
    const spend = approvalSpendToken({
      side: "sell",
      payNative: false,
      quoteToken: QUOTE_USDG,
      token: TOKEN,
    });
    assert.equal(spend, TOKEN);
    assert.equal(approvalSymbol({side: "sell", tokenSymbol: "PEPE", quoteToken: QUOTE_USDG}), "PEPE");
    assert.equal(approveButtonLabel("PEPE"), "Approve PEPE");
    assert.equal(tradeButtonLabel("sell", "PEPE"), "Sell PEPE");
  });
});

describe("exact HodlRouter approve", () => {
  it("encodes approve(HodlRouter, exact) and never max uint or Permit2", () => {
    const tx = encodeHodlApprove(QUOTE_USDG, ROUTER, AMOUNT);
    assert.equal(tx.to, QUOTE_USDG);
    assert.equal(tx.value, 0n);
    const decoded = decodedApprove(tx);
    assert.equal(decoded.spender.toLowerCase(), ROUTER);
    assert.equal(decoded.amount, AMOUNT);
    assert.notEqual(decoded.amount, maxUint256);
    assert.ok(isExactApproveAmount(decoded.amount));
    assert.notEqual(decoded.spender.toLowerCase(), UNIVERSAL_ROUTER);
    assert.notEqual(decoded.spender.toLowerCase(), PERMIT2);
  });

  it("rejects unlimited and non-router spenders", () => {
    assert.throws(() => encodeHodlApprove(QUOTE_USDG, ROUTER, maxUint256), /exact/i);
    assert.throws(() => encodeHodlApprove(QUOTE_USDG, UNIVERSAL_ROUTER, AMOUNT), /HodlRouter/i);
    assert.throws(() => encodeHodlApprove(QUOTE_USDG, PERMIT2, AMOUNT), /HodlRouter/i);
  });
});

describe("USDG and sell-token allowance reset", () => {
  it("does not require USDT-style 0-then-set for USDG or typical sell tokens", () => {
    assert.equal(requiresAllowanceReset(QUOTE_USDG), false);
    assert.equal(requiresAllowanceReset(TOKEN), false);
  });
});

describe("wallet confirm copy", () => {
  it("uses in-app copy for the embedded Privy wallet", () => {
    assert.equal(walletKindFrom(false), "embedded");
    assert.equal(pendingSignatureCopy("embedded", "approve"), "Confirm the approval in this app.");
    assert.equal(pendingSignatureCopy("embedded", "swap"), "Confirm the swap in this app.");
    assert.match(idleSignHint("embedded"), /in this app/i);
    assert.doesNotMatch(pendingSignatureCopy("embedded", "approve"), /wallet app/i);
    assert.doesNotMatch(pendingSignatureCopy("embedded", "swap"), /check your wallet/i);
  });

  it("tells imported wallets to leave and return", () => {
    assert.equal(walletKindFrom(true), "imported");
    assert.equal(
      pendingSignatureCopy("imported", "approve"),
      "Confirm the approval in your wallet app, then return here.",
    );
    assert.equal(
      pendingSignatureCopy("imported", "swap"),
      "Confirm the swap in your wallet app, then return here.",
    );
    assert.match(idleSignHint("imported"), /wallet app/i);
  });
});

describe("gas, quote refresh, and later visits", () => {
  it("fails a 2-tx path when native cannot cover both txs", () => {
    const needed = nativeWeiForPath({txs: 2, gasPrice: 1_000_000n});
    assert.ok(needed > nativeWeiForPath({txs: 1, gasPrice: 1_000_000n}));
    assert.equal(coversNative(needed - 1n, needed), false);
    assert.equal(coversNative(needed, needed), true);
  });

  it("re-quotes after approval wait without restarting approve", () => {
    assert.equal(
      shouldRequoteAfterApproval({approved: true, quoteExpired: true, allowanceOk: true}),
      true,
    );
    assert.equal(
      shouldRequoteAfterApproval({approved: true, quoteExpired: false, allowanceOk: true}),
      false,
    );
    assert.equal(
      shouldRequoteAfterApproval({approved: false, quoteExpired: true, allowanceOk: false}),
      false,
    );
  });

  it("keeps Buy after a failed swap when allowance is still sufficient", () => {
    assert.equal(
      nextTicketAction({
        allowanceOk: true,
        allowancePending: false,
        side: "buy",
        symbol: "PEPE",
        approvalSymbol: "USDG",
      }),
      "trade",
    );
  });

  it("shows Buy on a later visit once on-chain allowance covers the size", () => {
    assert.equal(allowanceSufficient(AMOUNT, AMOUNT), true);
    assert.equal(
      ticketButtonLabel("trade", {side: "sell", symbol: "PEPE", approvalSymbol: "PEPE"}),
      "Sell PEPE",
    );
  });
});
