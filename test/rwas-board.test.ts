import {describe, it} from "node:test";
import assert from "node:assert/strict";
import registry from "../src/lib/server/rwaRegistry.json" with {type: "json"};
import logos from "../src/lib/rwaLogos.json" with {type: "json"};
import {
  RWA_CATEGORIES,
  categoriesFor,
  keepOrder,
  parseCategory,
  parseRwaSort,
  shortCompanyName,
  sortLabel,
  sortRwaRows,
  topMovers,
  type RwaBoardRow,
} from "../src/lib/rwaBoard";
import {marketSession, needsDailyCloses, stockMove} from "../src/lib/rwaMove";
import type {SectorId} from "../src/lib/sectors";
import {parseQuote} from "../src/lib/server/live/robinhood";
import {wireSlice} from "../src/lib/server/live/news";
import {creditsDepleted} from "../src/lib/server/live/x";

const REGISTRY = registry as {ticker: string; name: string; sector: string}[];

function row(ticker: string, fields: Partial<RwaBoardRow> = {}): RwaBoardRow {
  return {
    ticker,
    id: ticker.toLowerCase(),
    name: ticker,
    logoUrl: null,
    categories: ["tech"],
    priceUsd: 10,
    changePct: 0,
    series: [],
    volumeUsd: null,
    marketCapUsd: null,
    chainVolumeUsd: null,
    pairedTokens: 0,
    pairedVolumeUsd: 0,
    ...fields,
  };
}

describe("RWA categories", () => {
  it("puts every RWA in at least one category", () => {
    const orphans = REGISTRY.filter((entry) => categoriesFor(entry.ticker, entry.sector as SectorId).length === 0);
    assert.deepEqual(orphans, []);
  });

  it("leaves no category empty", () => {
    for (const category of RWA_CATEGORIES) {
      const members = REGISTRY.filter((entry) => categoriesFor(entry.ticker, entry.sector as SectorId).includes(category.id));
      assert.ok(members.length > 0, category.label);
    }
  });

  it("files gold, silver and oil under Gold & Commodities, and still as funds", () => {
    for (const ticker of ["GLD", "SLV", "USO"]) {
      assert.deepEqual(categoriesFor(ticker, "funds"), ["funds", "commodities"]);
    }
    assert.deepEqual(categoriesFor("SPY", "funds"), ["funds"]);
  });

  it("maps the sectors the mockup has no name for", () => {
    assert.deepEqual(categoriesFor("RKLB", "space"), ["space"]);
    assert.deepEqual(categoriesFor("COIN", "crypto"), ["cryptofin"]);
    assert.deepEqual(categoriesFor("SOFI", "finance"), ["cryptofin"]);
    assert.deepEqual(categoriesFor("IONQ", "quantum"), ["tech"]);
  });

  it("reads unknown categories and sorts as the defaults", () => {
    assert.equal(parseCategory("gold"), "all");
    assert.equal(parseCategory("commodities"), "commodities");
    assert.equal(parseRwaSort("bogus"), "popular");
    assert.equal(parseRwaSort("mcap"), "mcap");
  });

  it("has a stored logo for every RWA", () => {
    const missing = REGISTRY.filter((entry) => !(entry.ticker in logos)).map((entry) => entry.ticker);
    assert.deepEqual(missing, []);
  });
});

describe("RWA sorting", () => {
  it("ranks most popular by chain volume, then paired-token volume", () => {
    const sorted = sortRwaRows(
      [
        row("AAA", {chainVolumeUsd: 100, pairedVolumeUsd: 1}),
        row("BBB", {chainVolumeUsd: 500}),
        row("CCC", {chainVolumeUsd: 100, pairedVolumeUsd: 9}),
        row("DDD", {chainVolumeUsd: null, pairedVolumeUsd: 50}),
      ],
      "popular",
    );
    assert.deepEqual(sorted.map((r) => r.ticker), ["BBB", "CCC", "AAA", "DDD"]);
  });

  it("puts rows without a value last, and orders names A–Z", () => {
    const rows = [row("MSFT", {changePct: null}), row("AAPL", {changePct: -2}), row("NVDA", {changePct: 3})];
    assert.deepEqual(sortRwaRows(rows, "change").map((r) => r.ticker), ["NVDA", "AAPL", "MSFT"]);
    assert.deepEqual(sortRwaRows(rows, "az").map((r) => r.ticker), ["AAPL", "MSFT", "NVDA"]);
  });

  it("picks the biggest moves each way, and only real moves", () => {
    const rows = [
      row("UP1", {changePct: 5}),
      row("UP2", {changePct: 9}),
      row("DN1", {changePct: -7}),
      row("FLAT", {changePct: 0}),
      row("NONE", {changePct: null}),
    ];
    assert.deepEqual(topMovers(rows, "up").map((r) => r.ticker), ["UP2", "UP1"]);
    assert.deepEqual(topMovers(rows, "down").map((r) => r.ticker), ["DN1"]);
  });

  it("calls the move column Last session % while the market is shut", () => {
    assert.equal(sortLabel("change", "today"), "Today %");
    assert.equal(sortLabel("change", "last"), "Last session %");
    assert.equal(sortLabel("paired", "last"), "Most tokens paired");
  });

  it("keeps the order on screen while frozen", () => {
    const next = keepOrder([row("A", {priceUsd: 1}), row("B")], [row("C"), row("B"), row("A", {priceUsd: 2})], true);
    assert.deepEqual(next.map((r) => [r.ticker, r.priceUsd]), [["A", 2], ["B", 10], ["C", 10]]);
    const latest = [row("B"), row("A")];
    assert.equal(keepOrder([row("A")], latest, false), latest);
  });

  it("drops share-class boilerplate from names", () => {
    assert.equal(shortCompanyName("ImmunityBio,"), "ImmunityBio");
    assert.equal(shortCompanyName("Space Exploration Technologies Corp. Class A Common Stock"), "Space Exploration Technologies");
    assert.equal(shortCompanyName("Cloudflare, Inc. Class A common stock"), "Cloudflare");
    assert.equal(shortCompanyName("SK hynix Inc. American Depositary Shares"), "SK hynix");
    assert.equal(shortCompanyName("NVIDIA"), "NVIDIA");
  });
});

describe("real market move", () => {
  // 30 Sep 2026 is a Wednesday. New York is UTC-4 then.
  const at = (iso: string) => new Date(iso);

  it("is open during the regular session while stocks trade", () => {
    assert.equal(marketSession(at("2026-09-30T17:00:00Z"), "2026-09-30T16:59:30Z"), "today");
  });

  it("is the last session before the open, after the close and at weekends", () => {
    assert.equal(marketSession(at("2026-09-30T12:00:00Z"), "2026-09-29T20:00:00Z"), "last");
    assert.equal(marketSession(at("2026-09-30T20:30:00Z"), "2026-09-30T20:00:00Z"), "last");
    assert.equal(marketSession(at("2026-10-03T16:00:00Z"), "2026-10-02T20:00:00Z"), "last");
  });

  it("reads a quiet weekday in session hours as a holiday", () => {
    assert.equal(marketSession(at("2026-11-26T16:00:00Z"), "2026-11-25T21:00:00Z"), "last");
  });

  it("is last price against the previous close", () => {
    const move = stockMove(
      {last: 110, previousClose: 100, previousCloseDate: "2026-09-29", lastTradeAt: "2026-09-30T17:00:00Z"},
      undefined,
    );
    assert.equal(move?.priceUsd, 110);
    assert.ok(Math.abs((move?.changePct ?? 0) - 10) < 1e-9);
  });

  it("uses the last two daily closes when the previous close has rolled forward", () => {
    const quote = {last: 110, previousClose: 110, previousCloseDate: "2026-09-30", lastTradeAt: "2026-09-30T19:59:00Z"};
    assert.equal(needsDailyCloses(quote), true);
    const move = stockMove(quote, [100, 104, 110]);
    assert.equal(move?.priceUsd, 110);
    assert.ok(Math.abs((move?.changePct ?? 0) - (110 / 104 - 1) * 100) < 1e-9);
  });

  it("has no move with nothing to measure against", () => {
    assert.equal(stockMove(undefined, undefined), null);
    assert.equal(stockMove({last: 5, previousClose: null, previousCloseDate: null, lastTradeAt: null}, [5]), null);
  });
});

describe("RWA volume", () => {
  it("is dollars — shares traded × price — not the share count", () => {
    const quote = parseQuote("NVDA", {
      quotes: [
        {tokenSymbol: "NVDA", bid: "230", ask: "230.2", dailyTradingVolume: "48274568", mintBurnUsdVolume: "7427628.93"},
      ],
    });
    assert.equal(quote?.volumeShares, 48274568);
    assert.ok(Math.abs((quote?.volume24hUsd ?? 0) - 48274568 * 230.1) < 1);
    assert.ok(Math.abs((quote?.chainVolumeUsd ?? 0) - 7427628.93) < 1e-6);
  });
});

describe("company news rotation", () => {
  it("covers every RWA across consecutive builds, a fifth at a time", () => {
    const window = 120_000;
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const slice = wireSlice(REGISTRY, i * window, 5, window);
      assert.ok(slice.length <= Math.ceil(REGISTRY.length / 5));
      for (const entry of slice) seen.add(entry.ticker);
    }
    assert.equal(seen.size, REGISTRY.length);
  });
});

describe("X credits", () => {
  it("recognises a depleted account", () => {
    assert.equal(creditsDepleted(402, null), true);
    assert.equal(creditsDepleted(403, {type: "https://api.x.com/2/problems/credits-depleted"}), true);
    assert.equal(creditsDepleted(429, null), false);
  });
});
