import {sectorFor} from "@/lib/sectors";
import type {
  Asset,
  AssetKind,
  ChartPoint,
  NewsItem,
  Range,
  RwaAsset,
  Timeframe,
  TokenAsset,
  Trade,
} from "@/lib/types";
import {between, fakeAddress, fakeHash, pick, rng} from "./rng";
import {RWA_SEEDS, TOKEN_SEEDS} from "./universe";

/**
 * The seeded market.
 *
 * Every number here is a pure function of an asset key and a timestamp, which
 * buys three things a random generator would not: a card and the chart page it
 * opens always agree, a chart redrawn on a timeframe switch is the same curve
 * at a different resolution, and reloading the feed does not reshuffle it.
 *
 * `sources.ts` is the seam where real feeds replace this.
 */

/** Minutes in each chart window, and how many points to draw across it. */
const WINDOWS: Record<Timeframe, {minutes: number; points: number}> = {
  "1m": {minutes: 60, points: 60},
  "5m": {minutes: 5 * 60, points: 90},
  "15m": {minutes: 15 * 60, points: 90},
  "1h": {minutes: 60 * 24, points: 96},
  "4h": {minutes: 60 * 24 * 4, points: 96},
  "1D": {minutes: 60 * 24 * 30, points: 120},
};

interface Harmonic {
  period: number;
  amp: number;
  phase: number;
}

/**
 * Two bands of periods, in minutes.
 *
 * The short band is what a 5m or 4h chart is made of. The long band — quarters
 * and years — barely moves inside a day, but without it a 1Y chart sampled at
 * weekly intervals aliases the weekly wave into noise around a flat line, and a
 * year of a portfolio looks like it went nowhere.
 */
const SHORT_PERIODS = [10080, 2880, 1440, 360, 90, 30, 8];
const SHORT_WEIGHTS = [1, 0.7, 0.5, 0.32, 0.2, 0.12, 0.06];

const LONG_PERIODS = [525_600, 175_200, 61_320];
const LONG_WEIGHTS = [1, 0.6, 0.35];

const harmonicCache = new Map<string, {short: Harmonic[]; long: Harmonic[]}>();

function build(
  next: () => number,
  periods: number[],
  weights: number[],
): Harmonic[] {
  return periods.map((period, i) => ({
    period,
    amp: weights[i] * between(next, 0.6, 1.4),
    phase: next() * Math.PI * 2,
  }));
}

function harmonicsFor(key: string) {
  const cached = harmonicCache.get(key);
  if (cached) return cached;

  const next = rng(`harmonics:${key}`);
  const built = {
    short: build(next, SHORT_PERIODS, SHORT_WEIGHTS),
    long: build(next, LONG_PERIODS, LONG_WEIGHTS),
  };
  harmonicCache.set(key, built);
  return built;
}

/**
 * A smooth, unbounded walk in log space.
 *
 * Summed sine waves rather than an accumulated random walk, because a walk
 * would have to be replayed from a fixed origin on every request to stay
 * stable — this is a constant number of terms at any point in time.
 */
function wave(harmonics: Harmonic[], minutes: number): number {
  let value = 0;
  for (const h of harmonics) {
    value += h.amp * Math.sin((minutes / h.period) * Math.PI * 2 + h.phase);
  }
  return value;
}

/**
 * Session wiggle and multi-year trend are scaled separately: a stock that moves
 * two percent in a day still moves forty over a year, and one volatility number
 * cannot produce both.
 */
const SHORT_VOL: Record<AssetKind, number> = {rwa: 0.018, token: 0.16};
const LONG_VOL: Record<AssetKind, number> = {rwa: 0.18, token: 0.7};

function priceAt(
  key: string,
  base: number,
  kind: AssetKind,
  atMs: number,
): number {
  const minutes = atMs / 60_000;
  const {short, long} = harmonicsFor(key);
  return (
    base *
    Math.exp(
      SHORT_VOL[kind] * wave(short, minutes) + LONG_VOL[kind] * wave(long, minutes),
    )
  );
}

function changeOver(
  key: string,
  base: number,
  kind: AssetKind,
  minutes: number,
  now: number,
): number {
  const then = priceAt(key, base, kind, now - minutes * 60_000);
  const live = priceAt(key, base, kind, now);
  return ((live - then) / then) * 100;
}

/** Rounds to the precision the asset actually trades at. */
export function roundPrice(value: number): number {
  if (value >= 1) return Number(value.toFixed(2));
  if (value >= 0.01) return Number(value.toFixed(4));
  return Number(value.toPrecision(3));
}

function cardSeries(
  key: string,
  base: number,
  kind: AssetKind,
  now: number,
): number[] {
  const span = 24 * 60 * 60_000;
  return Array.from({length: 24}, (_, i) =>
    roundPrice(priceAt(key, base, kind, now - span + (span * i) / 23)),
  );
}

// ---------------------------------------------------------------------------
// RWAs
// ---------------------------------------------------------------------------

export function listRwas(now: number = Date.now()): RwaAsset[] {
  return RWA_SEEDS.map((seed) => {
    const key = `rwa:${seed.ticker}`;
    const next = rng(`meta:${key}`);
    const price = priceAt(key, seed.basePrice, "rwa", now);
    const floatShares = between(next, 4e8, 9e9);

    return {
      kind: "rwa" as const,
      id: seed.ticker.toLowerCase(),
      ticker: seed.ticker,
      name: seed.name,
      logoUrl: null,
      contractAddress: fakeAddress(`rwa-token:${seed.ticker}`),
      verified: true as const,
      stockType: seed.stockType,
      sector: sectorFor(seed.ticker)?.id ?? "software",
      description: seed.description,
      priceUsd: roundPrice(price),
      changePct: Number(changeOver(key, seed.basePrice, "rwa", 1440, now).toFixed(2)),
      volume24hUsd: Math.round(price * floatShares * between(next, 0.002, 0.03)),
      marketCapUsd: Math.round(price * floatShares),
      circulatingSupply: floatShares,
      series: cardSeries(key, seed.basePrice, "rwa", now),
    };
  });
}

// ---------------------------------------------------------------------------
// Tokens with an RWA pair
// ---------------------------------------------------------------------------

/**
 * Shorter windows for the seeded feed.
 *
 * The seeded model only produces a daily figure, so the rest are divided out of
 * it rather than generated separately — that keeps a token's windows consistent
 * with each other, which is what the feed's filters compare.
 */
function seededWindows(
  volume24hUsd: number,
  changePct: number,
): TokenAsset["windows"] {
  return {
    "5m": {volumeUsd: Math.round(volume24hUsd / 288), changePct: Number((changePct / 12).toFixed(2))},
    "1h": {volumeUsd: Math.round(volume24hUsd / 24), changePct: Number((changePct / 6).toFixed(2))},
    "6h": {volumeUsd: Math.round(volume24hUsd / 4), changePct: Number((changePct / 2).toFixed(2))},
    "24h": {volumeUsd: volume24hUsd, changePct},
  };
}

export function listTokens(now: number = Date.now()): TokenAsset[] {
  return TOKEN_SEEDS.map((seed) => {
    const key = `token:${seed.symbol}`;
    const next = rng(`meta:${key}`);
    const address = fakeAddress(`token-contract:${seed.symbol}`);

    // Supply is fixed at deploy, so market cap moves only with price.
    const supply = pick(next, [1e9, 1e9, 1e9, 1e8, 1e10]);
    const basePrice = between(next, 0.00004, 0.0092);
    const price = priceAt(key, basePrice, "token", now);
    const marketCap = price * supply;
    const taxed = next() < 0.35;
    const volume = Math.round(marketCap * between(next, 0.04, 0.9));
    const feeBps = between(next, 20, 100);

    return {
      kind: "token" as const,
      id: address,
      address,
      symbol: seed.symbol,
      name: seed.name,
      imageUrl: null,
      priceUsd: roundPrice(price),
      changePct: Number(changeOver(key, basePrice, "token", 1440, now).toFixed(2)),
      volume24hUsd: volume,
      windows: seededWindows(
        volume,
        Number(changeOver(key, basePrice, "token", 1440, now).toFixed(2)),
      ),
      marketCapUsd: Math.round(marketCap),
      // The sample set prices its cap off a supply it made up, so the same
      // supply is carried through rather than left null — a sample asset should
      // rescale on the client exactly the way a real one does.
      circulatingSupply: price > 0 ? marketCap / price : null,
      liquidityUsd: Math.round(marketCap * between(next, 0.03, 0.14)),
      tradeable: true,
      rewards24hUsd: Math.round((volume * feeBps) / 10_000),
      rewardsToHolders: false,
      graduated: true,
      graduatedOnChain: true,
      tradesOnUniswap: true,
      paysRwaRewards: false,
      holders: Math.round(between(next, 240, 41_000)),
      createdAt: new Date(
        now - between(next, 2, 240) * 24 * 60 * 60_000,
      ).toISOString(),
      listedAt: new Date(
        now - between(next, 2, 240) * 24 * 60 * 60_000,
      ).toISOString(),
      pairedTicker: seed.pairedTicker,
      rwaPaired: true,
      // The seeded market has no contracts behind it, so there is nothing to
      // measure and nothing is claimed.
      buyTaxPct: null,
      sellTaxPct: null,
      feeSplit: null,
      // The seeded market is a fallback, not a claim about the chain. It has
      // no real deployments behind it, so it asserts no launchpad.
      launchpad: null,
      socials: seed.socials,
      description: seed.description,
      series: cardSeries(key, basePrice, "token", now),
    };
  });
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getAsset(
  kind: AssetKind,
  id: string,
  now: number = Date.now(),
): Asset | null {
  const wanted = id.toLowerCase();
  if (kind === "rwa") {
    return listRwas(now).find((asset) => asset.id === wanted) ?? null;
  }
  return (
    listTokens(now).find(
      (asset) =>
        asset.id.toLowerCase() === wanted ||
        asset.symbol.toLowerCase() === wanted,
    ) ?? null
  );
}

/** The seed inputs a chart or trade list needs, without re-deriving the asset. */
function priceInputs(asset: Asset): {key: string; base: number} {
  if (asset.kind === "rwa") {
    const seed = RWA_SEEDS.find((s) => s.ticker === asset.ticker);
    return {key: `rwa:${asset.ticker}`, base: seed?.basePrice ?? asset.priceUsd};
  }
  const next = rng(`meta:token:${asset.symbol}`);
  // Consumed in the same order as listTokens, so the base price matches.
  pick(next, [1e9, 1e9, 1e9, 1e8, 1e10]);
  return {key: `token:${asset.symbol}`, base: between(next, 0.00004, 0.0092)};

}

// ---------------------------------------------------------------------------
// Charts and trades
// ---------------------------------------------------------------------------

export function chartFor(
  asset: Asset,
  timeframe: Timeframe,
  now: number = Date.now(),
): ChartPoint[] {
  const {key, base} = priceInputs(asset);
  const {minutes, points} = WINDOWS[timeframe];
  const span = minutes * 60_000;
  const step = span / (points - 1);

  return Array.from({length: points}, (_, i) => {
    const t = now - span + step * i;
    return {t: Math.round(t), price: roundPrice(priceAt(key, base, asset.kind, t))};
  });
}

export function tradesFor(
  asset: Asset,
  limit = 40,
  now: number = Date.now(),
): Trade[] {
  const {key, base} = priceInputs(asset);
  const next = rng(`trades:${key}:${Math.floor(now / 60_000)}`);
  // Busier tokens print more often, so the gap between fills scales with size.
  const meanGapMs = asset.kind === "rwa" ? 42_000 : 15_000;

  const trades: Trade[] = [];
  let at = now - between(next, 1_000, 9_000);

  for (let i = 0; i < limit; i++) {
    const price = priceAt(key, base, asset.kind, at);
    const amountUsd = Math.round(
      between(next, 45, asset.kind === "rwa" ? 24_000 : 9_000) *
        (next() < 0.08 ? between(next, 4, 22) : 1),
    );
    const maker = fakeAddress(`maker:${key}:${i}:${Math.floor(at / 3_600_000)}`);

    trades.push({
      id: `${key}-${i}-${Math.round(at)}`,
      side: next() < 0.53 ? "buy" : "sell",
      amount: Number((amountUsd / price).toPrecision(6)),
      amountUsd,
      priceUsd: roundPrice(price),
      maker,
      txHash: fakeHash(`tx:${key}:${i}:${Math.round(at)}`),
      makerHandle: null,
      at: new Date(Math.round(at)).toISOString(),
    });

    at -= between(next, 0.2, 2.4) * meanGapMs;
  }

  return trades;
}

/**
 * A price series over one of the portfolio ranges.
 *
 * Shares `priceAt` with the chart, so a position's contribution to the
 * portfolio line and its own chart page cannot disagree.
 */
const RANGE_MINUTES: Record<Range, number> = {
  "1D": 60 * 24,
  "1W": 60 * 24 * 7,
  "1M": 60 * 24 * 30,
  "1Y": 60 * 24 * 365,
  ALL: 60 * 24 * 730,
};

export function seriesFor(
  asset: Asset,
  range: Range,
  points = 48,
  now: number = Date.now(),
): number[] {
  const {key, base} = priceInputs(asset);
  const span = RANGE_MINUTES[range] * 60_000;
  return Array.from({length: points}, (_, i) =>
    roundPrice(priceAt(key, base, asset.kind, now - span + (span * i) / (points - 1))),
  );
}

/**
 * The gas token, priced in dollars.
 *
 * Rides the same drift as everything else so an order denominated in ETH and
 * the same order denominated in dollars settle at a consistent rate. Scaled as
 * an RWA rather than a token: ETH moves, but not the way a launchpad coin does.
 */
export function ethPriceUsd(now: number = Date.now()): number {
  return roundPrice(priceAt("native:eth", 3200, "rwa", now));
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

const HEADLINE_TEMPLATES = [
  "{name} tokenized supply on Robinhood Chain crosses a new high",
  "Liquidity in {ticker} pairs deepens as market makers step in",
  "{name} volume picks up ahead of the next earnings print",
  "What the {ticker} tokenization means for round-the-clock trading",
  "{name} holders now split across custody and on-chain wrappers",
  "Desk note: how {ticker} has traded since the RWA listing",
];

const SOURCES = ["Market Wire", "Chain Desk", "The Ledger", "Onchain Daily"];

/**
 * Placeholder headlines.
 *
 * Deliberately not attributed to real publications, and flagged as sample data
 * by the route, so nothing here can be mistaken for reporting. The real feed
 * lands in `sources.fetchNews`.
 */
export function newsFor(asset: RwaAsset, now: number = Date.now()): NewsItem[] {
  const next = rng(`news:${asset.ticker}:${Math.floor(now / 3_600_000)}`);
  return HEADLINE_TEMPLATES.slice(0, 5).map((template, i) => ({
    id: `${asset.ticker}-news-${i}`,
    title: template
      .replaceAll("{name}", asset.name)
      .replaceAll("{ticker}", asset.ticker),
    url: "#",
    source: pick(next, SOURCES),
    publishedAt: new Date(
      now - between(next, 0.5, 60) * 3_600_000,
    ).toISOString(),
    summary: null,
  }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Matches tickers, symbols, names and contract addresses across both sides of
 * the universe. A pasted address is the whole point of the field, so it is
 * checked with a prefix match rather than a substring one.
 */
export function searchAssets(query: string, now: number = Date.now()): Asset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const all: Asset[] = [...listTokens(now), ...listRwas(now)];
  const scored = all
    .map((asset) => ({asset, score: scoreMatch(asset, q)}))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.asset.volume24hUsd ?? 0) - (a.asset.volume24hUsd ?? 0),
    );

  return scored.slice(0, 40).map((row) => row.asset);
}

function scoreMatch(asset: Asset, q: string): number {
  const symbol = (asset.kind === "rwa" ? asset.ticker : asset.symbol).toLowerCase();
  const address = (
    asset.kind === "rwa" ? asset.contractAddress : asset.address
  ).toLowerCase();
  const name = asset.name.toLowerCase();

  if (symbol === q) return 100;
  if (address.startsWith(q) && q.length >= 4) return 95;
  if (symbol.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (symbol.includes(q)) return 50;
  if (name.includes(q)) return 40;
  // A token is findable by the RWA it trades against — that is often the only
  // thing someone knows about it.
  if (asset.kind === "token" && asset.pairedTicker.toLowerCase() === q) return 60;
  return 0;
}
