import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {explainHodlError} from "../src/hooks/useHodlSwap";
import {explainSwapError} from "../src/hooks/useSwap";
import {
  decodeRevertHex,
  formatRevertForUser,
  isContractRevert,
} from "../src/lib/revertReason";
import {pickBestEthExit} from "../src/lib/swapRoute";

const ALLOWANCE_EXPIRED =
  "0xd81b2f2e0000000000000000000000000000000000000000000000000000000000000000";

describe("revert reason", () => {
  it("decodes Permit2 AllowanceExpired(0) from the failed AI sell", () => {
    const decoded = decodeRevertHex(ALLOWANCE_EXPIRED);
    assert.equal(decoded?.name, "AllowanceExpired");
    assert.equal(
      formatRevertForUser({data: ALLOWANCE_EXPIRED}),
      "Permit2 is not approved for this token. Approve, then sell.",
    );
    assert.equal(isContractRevert({data: ALLOWANCE_EXPIRED}), true);
    assert.equal(isContractRevert(new Error("fetch failed")), false);
  });

  it("does not hide AllowanceExpired as a generic pool reject or quote expiry", () => {
    const error = Object.assign(new Error("execution reverted"), {data: ALLOWANCE_EXPIRED});
    assert.match(explainSwapError(error), /Permit2/i);
    assert.match(explainHodlError(error), /Permit2/i);
    assert.doesNotMatch(explainHodlError(error), /quote expired/i);
    assert.doesNotMatch(explainSwapError(error), /pool rejected/i);
  });

  it("keeps a generic on-chain revert as the pool copy", () => {
    assert.match(explainSwapError(new Error("The transaction reverted on chain.")), /pool rejected/i);
    assert.match(explainHodlError(new Error("execution reverted")), /pool rejected/i);
  });
});

describe("ETH exit ranking", () => {
  it("prefers a direct ETH hop when it is within 3% of a multi-hop quote", () => {
    const hop = {ethOut: 1000n, hop2: {venue: "v3"}};
    const direct = {ethOut: 980n};
    const thin = {ethOut: 900n};
    assert.equal(pickBestEthExit([hop, direct]), direct);
    assert.equal(pickBestEthExit([hop, thin]), hop);
    assert.equal(pickBestEthExit([direct]), direct);
  });
});
