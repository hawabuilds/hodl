import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {applyDexPair} from "../src/lib/server/live/feedDecorate";
import type {DexPair} from "../src/lib/server/live/dexscreener";
import type {TokenAsset} from "../src/lib/types";
import {
  classifySocialUrl,
  mergeSocials,
  skipDexScreener,
  socialsFromLongLinks,
  socialsFromPonsTuple,
  socialsSourceFor,
} from "../src/lib/server/live/tokenSocials";
import {WORKER_LIVE_TIP} from "../src/lib/server/live/liveTip";

function blankToken(): TokenAsset {
  return {
    kind: "token",
    id: "0xabc",
    address: "0xabc",
    symbol: "TEST",
    name: "Test",
    imageUrl: "https://store/logo.png",
    priceUsd: 0,
    changePct: 0,
    volume24hUsd: 0,
    marketCapUsd: 0,
    circulatingSupply: 1_000_000,
    liquidityUsd: 0,
    tradeable: null,
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
      "24h": {volumeUsd: 0, changePct: 0},
    },
    holders: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    listedAt: "2026-01-01T00:00:00.000Z",
    pairedTicker: "USDG",
    rwaPaired: false,
    buyTaxPct: null,
    sellTaxPct: null,
    feeSplit: null,
    launchpad: null,
    socials: {
      x: "https://x.com/stored",
      telegram: "https://t.me/stored",
      website: null,
      discord: null,
    },
    description: "Test",
    series: [],
  };
}

describe("token social merge", () => {
  it("maps the Pons 5-tuple and classifies an X URL in the website slot", () => {
    const debt = socialsFromPonsTuple([
      "https://x.com/DebtcoinRH/status/2096440529278161368",
      "",
      "",
      "https://x.com/DebtcoinRH",
      "",
    ]);
    assert.equal(debt.x, "https://x.com/DebtcoinRH/status/2096440529278161368");
    assert.equal(debt.website, null);

    const delivery = socialsFromPonsTuple([
      "https://x.com/DeliveryGuyRHoo",
      "https://t.me/deliveryguytg",
      "",
      "https://www.deliveryguyups.com/",
      "",
    ]);
    assert.equal(delivery.x, "https://x.com/DeliveryGuyRHoo");
    assert.equal(delivery.telegram, "https://t.me/deliveryguytg");
    assert.equal(delivery.website, "https://www.deliveryguyups.com/");
    assert.equal(delivery.discord, null);
  });

  it("reads Long social_links by URL host, not the label", () => {
    const links = socialsFromLongLinks([
      {label: "Website", url: "https://x.com/loraclexyz"},
      {label: "Website", url: "https://example.com/rizo"},
    ]);
    assert.equal(links.x, "https://x.com/loraclexyz");
    assert.equal(links.website, "https://example.com/rizo");
  });

  it("merges per field and never blanks a set value", () => {
    const merged = mergeSocials(
      {x: "https://x.com/pons", telegram: null, website: null, discord: null},
      {
        x: "https://x.com/dex",
        telegram: "https://t.me/dex",
        website: "https://dex.example",
        discord: null,
      },
    );
    assert.equal(merged.x, "https://x.com/pons");
    assert.equal(merged.telegram, "https://t.me/dex");
    assert.equal(merged.website, "https://dex.example");
    assert.equal(socialsSourceFor("pons", {x: "https://x.com/pons", telegram: null, website: null, discord: null}, merged), "pons");
    assert.equal(classifySocialUrl("https://discord.gg/abc"), "discord");
  });

  it("applyDexPair does not clear stored socials", () => {
    const pair: DexPair = {
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0xpair",
      baseToken: {address: "0xabc", name: "Test", symbol: "TEST"},
      quoteToken: {address: "0xquote", name: "USDG", symbol: "USDG"},
      priceUsd: "0.0042",
      liquidity: {usd: 80_000},
      info: {
        imageUrl: "https://dex.example/other.png",
        websites: [{url: "https://dex-site.example"}],
        socials: [{type: "twitter", url: "https://x.com/dex"}],
      },
    };
    const decorated = applyDexPair(blankToken(), pair);
    assert.equal(decorated.socials.x, "https://x.com/stored");
    assert.equal(decorated.socials.telegram, "https://t.me/stored");
    assert.equal(decorated.imageUrl, "https://store/logo.png");
  });
});

describe("worker social persist path", () => {
  it("worker still resolves socials on the image persist path", () => {
    assert.equal(WORKER_LIVE_TIP.skipImages, false);
    const images = readFileSync(
      join(process.cwd(), "src/lib/server/live/tokenImages.ts"),
      "utf8",
    );
    const indexer = readFileSync(
      join(process.cwd(), "src/lib/server/live/tokenIndexer.ts"),
      "utf8",
    );
    assert.match(images, /persistResolvedMedia/);
    assert.match(images, /writeTokenSocials/);
    assert.match(images, /pairsForAddresses/);
    assert.match(images, /persistRecentMissingImages/);
    assert.match(indexer, /persistResolvedImages/);
    assert.match(indexer, /if \(!extras\.skipImages\)/);
    assert.match(indexer, /rememberSeenAfterImages/);
  });

  it("skips Dex when SKIP_DEXSCREENER=1, not when forced off", () => {
    const env = process.env as Record<string, string | undefined>;
    const held = env.SKIP_DEXSCREENER;
    const nodeEnv = env.NODE_ENV;
    const railway = env.RAILWAY_ENVIRONMENT;
    const service = env.RAILWAY_SERVICE_NAME;
    try {
      env.SKIP_DEXSCREENER = "1";
      assert.equal(skipDexScreener(), true);
      env.SKIP_DEXSCREENER = "0";
      assert.equal(skipDexScreener({onchainOnly: true}), true);
      assert.equal(skipDexScreener(), false);
      delete env.SKIP_DEXSCREENER;
      env.NODE_ENV = "development";
      delete env.RAILWAY_ENVIRONMENT;
      delete env.RAILWAY_SERVICE_NAME;
      assert.equal(skipDexScreener(), true);
      env.RAILWAY_ENVIRONMENT = "production";
      assert.equal(skipDexScreener(), false);
    } finally {
      if (held == null) delete env.SKIP_DEXSCREENER;
      else env.SKIP_DEXSCREENER = held;
      if (nodeEnv == null) delete env.NODE_ENV;
      else env.NODE_ENV = nodeEnv;
      if (railway == null) delete env.RAILWAY_ENVIRONMENT;
      else env.RAILWAY_ENVIRONMENT = railway;
      if (service == null) delete env.RAILWAY_SERVICE_NAME;
      else env.RAILWAY_SERVICE_NAME = service;
    }
  });
});
