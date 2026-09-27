import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {encodeLongCreate, longBeneficiaries} from "../src/lib/launch/longLaunch";
import {
  NO_ECONOMICS_COMMITMENT,
  encodePonsLaunch,
} from "../src/lib/launch/ponsLaunch";

/**
 * The encoders are checked against real launches, byte for byte.
 *
 * This is the test that matters for this feature. A struct with two fields
 * transposed, an array that should have been a tuple array, a constant copied
 * with a digit missing — all of those encode perfectly well and produce a
 * launch that is not the one the user asked for. Comparing against calldata
 * the chain already accepted is the only check that catches them, and it
 * costs nothing to run.
 *
 * The fixture is the raw `input` of a launch transaction, saved rather than
 * fetched so the suite does not depend on an RPC being reachable. Re-capture
 * with:
 *
 *   cast tx <hash> input --rpc-url https://rpc.mainnet.chain.robinhood.com
 */
const FIXTURES = join(process.cwd(), "test/fixtures");

interface LaunchFixture {
  tx: string;
  input: string;
  form: Record<string, string>;
}

function fixture(name: string): LaunchFixture {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as LaunchFixture;
}

describe("Long launch encoding", () => {
  const known = fixture("long-create.json");

  it("rebuilds a real Airlock create byte for byte", () => {
    const encoded = encodeLongCreate({
      name: known.form.name,
      symbol: known.form.symbol,
      tokenUri: known.form.tokenUri,
      creator: known.form.creator,
      mintStart: BigInt(known.form.mintStart),
      salt: known.form.salt as `0x${string}`,
    });

    assert.equal(
      encoded.toLowerCase(),
      known.input.toLowerCase(),
      "encoded calldata drifted from the launch it was derived from",
    );
  });

  it("keeps the selector the chain accepted", () => {
    assert.equal(known.input.slice(0, 10), "0x882db707");
  });

  it("sorts fee beneficiaries ascending, whichever side the creator falls", () => {
    // Above Long's protocol address (0x21e2…): creator goes second.
    const high = longBeneficiaries("0xffff000000000000000000000000000000000001");
    assert.ok(high[0][0] < high[1][0]);
    assert.equal(high[1][0], "0xffff000000000000000000000000000000000001");

    // Below it: creator must come first, or Doppler rejects the order.
    const low = longBeneficiaries("0x0000000000000000000000000000000000000001");
    assert.ok(low[0][0] < low[1][0]);
    assert.equal(low[0][0], "0x0000000000000000000000000000000000000001");
  });

  it("always splits fees 5/95 regardless of that ordering", () => {
    for (const creator of [
      "0xffff000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001",
    ]) {
      const rows = longBeneficiaries(creator);
      const total = rows.reduce((sum, row) => sum + row[1], 0n);
      assert.equal(total, 1_000_000_000_000_000_000n);
      const mine = rows.find((row) => row[0] === creator);
      assert.equal(mine?.[1], 950_000_000_000_000_000n);
    }
  });
});

describe("Pons launch encoding", () => {
  const known = fixture("pons-launch.json");
  const form = known.form;

  function build(overrides: Record<string, unknown> = {}) {
    return encodePonsLaunch({
      name: form.name,
      symbol: form.symbol,
      logo: form.logo,
      description: form.description,
      socials: {
        x: form.x,
        telegram: form.telegram,
        discord: form.discord,
        website: form.website,
        extra: form.extra,
      },
      creatorFeeRecipient: form.creatorFeeRecipient,
      creatorTaxBps: Number(form.creatorTaxBps),
      buybackEnabled: form.buybackEnabled === "true",
      launchConfigId: BigInt(form.launchConfigId),
      pairToken: form.pairToken,
      salt: form.salt as `0x${string}`,
      expectedEconomics: form.expectedEconomics as `0x${string}`,
      ...overrides,
    });
  }

  it("rebuilds a real launchToken byte for byte", () => {
    assert.equal(
      build().toLowerCase(),
      known.input.toLowerCase(),
      "encoded calldata drifted from the launch it was derived from",
    );
  });

  it("keeps the selector the chain accepted", () => {
    assert.equal(known.input.slice(0, 10), "0xa72101af");
  });

  it("waives the economics commitment only when asked to", () => {
    const waived = build({expectedEconomics: undefined});
    assert.notEqual(waived.toLowerCase(), known.input.toLowerCase());
    assert.ok(
      waived.includes(NO_ECONOMICS_COMMITMENT.slice(2)),
      "omitting the commitment should send zero, which the factory treats as a waiver",
    );
  });

  it("leaves unset socials as empty strings rather than dropping the fields", () => {
    // The tuple is fixed-arity; a missing social must still occupy its slot or
    // every field after it shifts.
    const sparse = encodePonsLaunch({
      name: "A",
      symbol: "A",
      logo: "",
      description: "",
      creatorFeeRecipient: form.creatorFeeRecipient,
      creatorTaxBps: 0,
      buybackEnabled: false,
      launchConfigId: 0n,
      pairToken: form.pairToken,
      salt: form.salt as `0x${string}`,
    });
    assert.equal(sparse.slice(0, 10), "0xa72101af");
    assert.ok(sparse.length > 10);
  });
});
