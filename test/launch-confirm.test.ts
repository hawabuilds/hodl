import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {launchedToken} from "../src/lib/launch/launchReceipt";
import {LONG_MODULES, PONS_LAUNCH_FACTORY} from "../src/lib/launch/launchConfig";

/**
 * The confirm route must not take the caller's word for what was launched.
 *
 * It is handed a transaction hash and reads the token out of that
 * transaction's own receipt, from a log emitted by the launchpad's contract.
 * These tests hold that line: a log from the wrong contract, or the wrong
 * event, or no log at all, must yield nothing to write.
 */

const PONS_TOPIC =
  "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const CREATE_TOPIC =
  "0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab";

const TOKEN = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const padded = `0x000000000000000000000000${TOKEN.slice(2)}`;

function ponsLog(over: Partial<{address: string; topics: string[]}> = {}) {
  return {
    address: PONS_LAUNCH_FACTORY,
    topics: [PONS_TOPIC, padded, padded, padded],
    data: "0x",
    ...over,
  };
}

function longLog(over: Partial<{address: string; topics: string[]}> = {}) {
  return {
    address: LONG_MODULES.airlock,
    topics: [CREATE_TOPIC, padded],
    // asset is the first word of the non-indexed data
    data: `0x000000000000000000000000${TOKEN.slice(2)}`,
    ...over,
  };
}

describe("confirm reads the launch from the receipt", () => {
  it("finds the Pons token in its factory's own log", () => {
    assert.equal(launchedToken([ponsLog()], "pons"), TOKEN);
  });

  it("finds the Long asset in the Airlock's own log", () => {
    assert.equal(launchedToken([longLog()], "long"), TOKEN);
  });

  it("ignores a correctly-shaped log from the wrong contract", () => {
    const impostor = ponsLog({address: "0x1111111111111111111111111111111111111111"});
    assert.equal(launchedToken([impostor], "pons"), null);
  });

  it("ignores the right contract emitting a different event", () => {
    const other = ponsLog({topics: ["0x" + "11".repeat(32), padded, padded, padded]});
    assert.equal(launchedToken([other], "pons"), null);
  });

  it("does not accept a Long log as a Pons launch, or the reverse", () => {
    assert.equal(launchedToken([longLog()], "pons"), null);
    assert.equal(launchedToken([ponsLog()], "long"), null);
  });

  it("yields nothing from a receipt that launched nothing", () => {
    assert.equal(launchedToken([], "pons"), null);
  });

  it("picks the launch out of a receipt full of unrelated logs", () => {
    const noise = {
      address: "0x2222222222222222222222222222222222222222",
      topics: ["0x" + "22".repeat(32)],
      data: "0x",
    };
    assert.equal(launchedToken([noise, ponsLog(), noise], "pons"), TOKEN);
  });
});
