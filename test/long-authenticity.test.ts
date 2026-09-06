import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  FAKE_LONG_EXAMPLE,
  hasCloneLongVanity,
  hasLongAppVanity,
  isDeniedFakeLong,
  isLongAppMetadata,
  longAuthenticityFromSignals,
  longWriteEligible,
} from "../src/lib/longAuthenticity";

const REAL_LONG_METADATA = {
  name: "Ladyboner Coin",
  description: "fixture",
  image_hash: "ipfs://bafkreif5n3uno2o7wfaihdul4o7btscdfusi6lvm52lrrfuz3uy6iooscm",
  social_links: [{label: "Website", url: "https://x.com/example"}],
  vesting_recipients: [{address: "0x0000000000000000000000000000000000000000", amount: 0}],
  fee_receiver: "0xF076346F695a0E77256e109E39203A863732222b",
  categories: [],
};

const FAKE_LONG_METADATA = {
  name: "Blackberry Curve",
  description: "A community token to resurrect the golden age of the Blackberry Curve.",
  image_hash: "ipfs://bafybeibmzsyyvxiw5pjhomzmuuqg6f24xxi5g4lic4jphkb55bqoczot2m",
  social_links: [],
};

const REAL_LONG_ADDRESS = "0xbe58054707de04f849b16db6020ddb5ec0521e18";

describe("long authenticity", () => {
  it("denies the example fake case-insensitively", () => {
    assert.equal(isDeniedFakeLong(FAKE_LONG_EXAMPLE), true);
    assert.equal(
      isDeniedFakeLong("0x066820c460B6Ca092a58F402fF0A72703b1aF72e"),
      true,
    );
    assert.equal(isDeniedFakeLong(REAL_LONG_ADDRESS), false);
  });

  it("treats ba3 CREATE2 vanity as a clone, not Long-app 1e18", () => {
    assert.equal(hasCloneLongVanity("0x01234567890abcdef1234567890abcdef1234ba3"), true);
    assert.equal(hasCloneLongVanity(REAL_LONG_ADDRESS), false);
    assert.equal(hasLongAppVanity(REAL_LONG_ADDRESS), true);
    assert.equal(hasLongAppVanity(FAKE_LONG_EXAMPLE), false);
  });

  it("accepts Long-app tokenURI JSON and rejects the example schema", () => {
    assert.equal(isLongAppMetadata(REAL_LONG_METADATA), true);
    assert.equal(isLongAppMetadata(FAKE_LONG_METADATA), false);
    assert.equal(isLongAppMetadata(null), false);
    assert.equal(isLongAppMetadata({fee_receiver: "not-an-address"}), false);
  });

  it("hides the example even before URI JSON is fetched", () => {
    assert.equal(longAuthenticityFromSignals({address: FAKE_LONG_EXAMPLE}), false);
    assert.equal(
      longAuthenticityFromSignals({
        address: FAKE_LONG_EXAMPLE,
        metadata: FAKE_LONG_METADATA,
        metadataResolved: true,
      }),
      false,
    );
    assert.equal(longWriteEligible(false), false);
  });

  it("keeps a real Long fixture visible", () => {
    assert.equal(
      longAuthenticityFromSignals({
        address: REAL_LONG_ADDRESS,
        metadata: REAL_LONG_METADATA,
        metadataResolved: true,
      }),
      true,
    );
    assert.equal(longWriteEligible(true), true);
    assert.equal(longWriteEligible(null), true);
  });

  it("does not hide an unevaluated Long that is not denied", () => {
    assert.equal(
      longAuthenticityFromSignals({address: REAL_LONG_ADDRESS}),
      null,
    );
  });
});
