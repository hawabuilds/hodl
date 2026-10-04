import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {maxUint160, maxUint256} from "viem";
import {
  PERMIT2,
  QUOTE_ETH,
  QUOTE_USDG,
  UNIVERSAL_ROUTER,
} from "../src/lib/contracts";
import {permit2Expiry} from "../src/lib/swapTx";
import {
  allowanceSufficient,
  approvalSpendToken,
  approvalSymbol,
  approveButtonLabel,
  assertSpendCovered,
  canStartSellApprove,
  coversNative,
  decodedApprove,
  encodeHodlApprove,
  idleSignHint,
  hodlApprovalSteps,
  permit2ApprovalSteps,
  nativeWeiForPath,
  nextTicketAction,
  pendingSignatureCopy,
  requiresAllowanceReset,
  sellBalanceBlockReason,
  shouldRequoteAfterApproval,
  spendBalanceBlockReason,
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

describe("sell balance must cover approve", () => {
  it("cannot start sell approve at 0 balance", () => {
    assert.equal(canStartSellApprove({heldRaw: 0n, amountIn: 1n}), false);
    assert.equal(canStartSellApprove({heldRaw: 0n, amountIn: 0n}), false);
    assert.equal(
      sellBalanceBlockReason({side: "sell", symbol: "AI", heldRaw: 0n, amountIn: 1n}),
      "You have 0 AI",
    );
    assert.equal(
      spendBalanceBlockReason({heldRaw: 0n, amount: AMOUNT, symbol: "AI"}),
      "You have 0 AI",
    );
    assert.throws(
      () => assertSpendCovered({heldRaw: 0n, amount: AMOUNT, symbol: "AI"}),
      /You have 0 AI/,
    );
  });

  it("blocks a sell size above the on-chain balance", () => {
    assert.equal(canStartSellApprove({heldRaw: AMOUNT, amountIn: AMOUNT + 1n}), false);
    assert.equal(
      sellBalanceBlockReason({
        side: "sell",
        symbol: "AI",
        heldRaw: AMOUNT,
        amountIn: AMOUNT + 1n,
      }),
      "Amount exceeds your balance",
    );
    assert.equal(
      sellBalanceBlockReason({
        side: "sell",
        symbol: "AI",
        heldRaw: AMOUNT,
        amountUsd: 26,
        heldUsd: 25,
      }),
      "Amount exceeds your balance",
    );
    assert.throws(
      () => assertSpendCovered({heldRaw: AMOUNT, amount: AMOUNT + 1n}),
      /Amount exceeds your balance/,
    );
  });

  it("applies the same sell rule to an RWA ticker", () => {
    assert.equal(canStartSellApprove({heldRaw: 0n, amountIn: 1n}), false);
    assert.equal(
      sellBalanceBlockReason({side: "sell", symbol: "IBM", heldRaw: 0n, amountIn: 1n}),
      "You have 0 IBM",
    );
    assert.equal(
      sellBalanceBlockReason({
        side: "sell",
        symbol: "IBM",
        heldRaw: 50n,
        amountIn: 51n,
      }),
      "Amount exceeds your balance",
    );
    assert.equal(canStartSellApprove({heldRaw: 50n, amountIn: 50n}), true);
  });

  it("does not block a buy when the wallet holds 0 of the output token", () => {
    assert.equal(
      sellBalanceBlockReason({side: "buy", symbol: "AI", heldRaw: 0n, amountIn: AMOUNT}),
      null,
    );
    assert.equal(
      approvalSpendToken({
        side: "buy",
        payNative: true,
        quoteToken: QUOTE_ETH,
        token: TOKEN,
      }),
      null,
    );
    assert.equal(canStartSellApprove({heldRaw: AMOUNT, amountIn: AMOUNT}), true);
  });
});

describe("HodlRouter approve", () => {
  it("encodes approve(HodlRouter, max) and never Universal Router or Permit2", () => {
    const tx = encodeHodlApprove(QUOTE_USDG, ROUTER);
    assert.equal(tx.to, QUOTE_USDG);
    assert.equal(tx.value, 0n);
    const decoded = decodedApprove(tx);
    assert.equal(decoded.spender.toLowerCase(), ROUTER);
    assert.equal(decoded.amount, maxUint256);
  });

  it("rejects non-router spenders", () => {
    assert.throws(() => encodeHodlApprove(QUOTE_USDG, UNIVERSAL_ROUTER), /HodlRouter/i);
    assert.throws(() => encodeHodlApprove(QUOTE_USDG, PERMIT2), /HodlRouter/i);
  });
});

describe("wallet prompts, first trade vs repeat trade", () => {
  const NOW = 1_800_000_000;
  const DAY = 24 * 60 * 60;

  it("HodlRouter: approve + swap first, swap only after", () => {
    assert.deepEqual(hodlApprovalSteps({allowance: 0n, need: AMOUNT}), ["approve-router"]);
    // max allowance is never spent down below a trade size
    assert.deepEqual(hodlApprovalSteps({allowance: maxUint256 - AMOUNT, need: AMOUNT}), []);
    assert.deepEqual(hodlApprovalSteps({allowance: maxUint256, need: AMOUNT * 1000n}), []);
  });

  it("an old exact allowance left from before still asks once more", () => {
    assert.deepEqual(hodlApprovalSteps({allowance: AMOUNT - 1n, need: AMOUNT}), ["approve-router"]);
  });

  it("Universal Router: approve + Permit2 + swap first, swap only after", () => {
    assert.deepEqual(
      permit2ApprovalSteps({tokenAllowance: 0n, permit2Amount: 0n, permit2Expiration: 0, need: AMOUNT, nowSec: NOW}),
      ["approve-permit2", "permit2-allow"],
    );
    assert.deepEqual(
      permit2ApprovalSteps({
        tokenAllowance: maxUint256 - AMOUNT,
        permit2Amount: maxUint160,
        permit2Expiration: permit2Expiry(NOW),
        need: AMOUNT,
        nowSec: NOW + DAY,
      }),
      [],
    );
  });

  it("re-signs only Permit2 once its 30 days run out", () => {
    assert.equal(permit2Expiry(NOW), NOW + 30 * DAY);
    assert.deepEqual(
      permit2ApprovalSteps({
        tokenAllowance: maxUint256,
        permit2Amount: maxUint160,
        permit2Expiration: permit2Expiry(NOW),
        need: AMOUNT,
        nowSec: NOW + 30 * DAY,
      }),
      ["permit2-allow"],
    );
  });

  it("an old 30-minute exact Permit2 allowance is replaced", () => {
    assert.deepEqual(
      permit2ApprovalSteps({tokenAllowance: 0n, permit2Amount: AMOUNT, permit2Expiration: NOW + 1800, need: AMOUNT * 2n, nowSec: NOW}),
      ["approve-permit2", "permit2-allow"],
    );
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
