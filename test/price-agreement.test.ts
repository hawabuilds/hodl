import {afterEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  PRICE_AGREEMENT_RATIO,
  pricesAgree,
  withoutStoredSnapshot,
} from "../src/lib/priceState";
import {
  FEED_READING_MAX_AGE_MS,
  feedReadings,
  priceFor,
  publishPrice,
  publishPrices,
  resetPrices,
} from "../src/lib/livePrice";
import {applyDexPair} from "../src/lib/server/live/feedDecorate";
import type {DexPair} from "../src/lib/server/live/dexscreener";
import type {TokenAsset} from "../src/lib/types";

/**
 * Insulinu (0x9477…2543, paired with LLY) showed two prices on its own page.
 *
 * Its `token_stats` row was last written on 2026-09-15 at 0.00005632, with a
 * $56.3k cap and $21.5k of liquidity. By the 30th its only real pool, and every
 * fill on its tape, sat at 0.0000026 against $3.4k. DexScreener lists no pair
 * for it, so whenever Gecko was rate limited the page served the stored row,
 * and the feed published that row into the shared price stamped as current —
 * where it beat every fill the tape had.
 */

const STORED = 0.00005632;
const POOL = 0.000002583;

function insulinu(overrides: Partial<TokenAsset> = {}): TokenAsset {
  return {
    kind: "token",
    id: "0x94772dc9d30bcc0e2f1c0ca1118dda631c1b2543",
    address: "0x94772dc9d30bcc0e2f1c0ca1118dda631c1b2543",
    symbol: "Insulinu",
    name: "Insulinu",
    imageUrl: null,
    priceUsd: STORED,
    priceAt: "2026-09-15T14:15:13.943Z",
    changePct: -81.96,
    volume24hUsd: 116_597,
    marketCapUsd: 56_320,
    circulatingSupply: 1_000_000_000,
    liquidityUsd: 21_513,
    tradeable: true,
    rewards24hUsd: 0,
    rewardsToHolders: false,
    graduated: true,
    graduatedOnChain: true,
    tradesOnUniswap: true,
    paysRwaRewards: false,
    windows: {
      "5m": {volumeUsd: 0, changePct: 0},
      "1h": {volumeUsd: 0, changePct: 0},
      "6h": {volumeUsd: 0, changePct: 0},
      "24h": {volumeUsd: 116_597, changePct: -81.96},
    },
    holders: 0,
    createdAt: "2026-09-14T13:11:24Z",
    listedAt: "2026-09-14T13:11:24Z",
    pairedTicker: "LLY",
    rwaPaired: true,
    buyTaxPct: null,
    sellTaxPct: null,
    feeSplit: null,
    launchpad: null,
    socials: {x: null, telegram: null, website: null, discord: null},
    description: "",
    series: [],
    ...overrides,
  };
}

describe("a stored price checked against its pool", () => {
  it("disagrees when the store is twenty-two times the pool", () => {
    assert.equal(pricesAgree(STORED, POOL), false);
    assert.equal(pricesAgree(POOL, STORED), false);
  });

  it("agrees inside the ratio, either way round", () => {
    assert.equal(pricesAgree(POOL, POOL * 1.5), true);
    assert.equal(pricesAgree(POOL * 1.5, POOL), true);
    assert.equal(pricesAgree(POOL, POOL * PRICE_AGREEMENT_RATIO), true);
    assert.equal(pricesAgree(POOL, POOL * PRICE_AGREEMENT_RATIO * 1.01), false);
  });

  it("never agrees with a price that is not one", () => {
    assert.equal(pricesAgree(0, POOL), false);
    assert.equal(pricesAgree(POOL, Number.NaN), false);
    assert.equal(pricesAgree(-POOL, -POOL), false);
  });

  it("drops the whole snapshot, not only the price", () => {
    const out = withoutStoredSnapshot(insulinu());
    assert.equal(out.priceUsd, null);
    assert.equal(out.priceAt, null);
    assert.equal(out.marketCapUsd, null);
    assert.equal(out.liquidityUsd, null);
    assert.equal(out.volume24hUsd, null);
    assert.equal(out.changePct, 0);
    assert.deepEqual(out.windows["24h"], {volumeUsd: 0, changePct: 0});
    // Identity and supply are not part of the price read.
    assert.equal(out.address, insulinu().address);
    assert.equal(out.circulatingSupply, 1_000_000_000);
    assert.equal(out.tradeable, true);
  });
});

describe("feed prices in the shared price", () => {
  const now = Date.parse("2026-09-30T10:00:00Z");

  afterEach(() => resetPrices());

  it("keeps a weeks-old store price out", () => {
    assert.deepEqual(feedReadings([insulinu()], now, now), []);
  });

  it("stamps a reading with when it was read, not when it was fetched", () => {
    const readAt = now - 60_000;
    const [reading] = feedReadings(
      [insulinu({priceUsd: POOL, priceAt: new Date(readAt).toISOString()})],
      now,
      now,
    );
    assert.deepEqual(reading, {id: insulinu().id, price: POOL, at: readAt});
  });

  it("uses the payload's time when the server did not say", () => {
    const [reading] = feedReadings(
      [{id: "nvda", priceUsd: 180}],
      now - 5_000,
      now,
    );
    assert.equal(reading.at, now - 5_000);
  });

  it("ages a cached payload by its own time", () => {
    const asOf = now - FEED_READING_MAX_AGE_MS - 1;
    assert.deepEqual(feedReadings([{id: "nvda", priceUsd: 180}], asOf, now), []);
  });

  it("skips an unpriced row", () => {
    assert.deepEqual(feedReadings([insulinu({priceUsd: null})], now, now), []);
  });

  it("lets the tape's fill stand over an older feed reading", () => {
    const id = insulinu().id;
    const fillAt = now - 3 * 60_000;
    publishPrice(id, POOL, fillAt);
    // A store price read ten minutes ago, fetched just now.
    publishPrices(
      feedReadings(
        [insulinu({priceAt: new Date(now - 10 * 60_000).toISOString()})],
        now,
        now,
      ),
    );
    assert.equal(priceFor(id), POOL);
  });
});

describe("when a price was read", () => {
  const pair = (priceUsd: string | undefined): DexPair =>
    ({
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0xpool",
      baseToken: {address: insulinu().address, name: "Insulinu", symbol: "Insulinu"},
      quoteToken: {address: "0xquote", name: "Q", symbol: "Q"},
      priceUsd,
      liquidity: {usd: 3_394},
    }) as DexPair;

  it("is now when the pair priced it", () => {
    const before = Date.now();
    const out = applyDexPair(insulinu(), pair(String(POOL)));
    assert.equal(out.priceUsd, POOL);
    assert.ok(Date.parse(out.priceAt ?? "") >= before);
  });

  it("stays the store's when the pair did not", () => {
    const out = applyDexPair(insulinu(), pair(undefined));
    assert.equal(out.priceUsd, STORED);
    assert.equal(out.priceAt, insulinu().priceAt);
  });
});
