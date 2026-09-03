import type {SectorId} from "@/lib/sectors";
import type {Asset, RwaAsset, TokenAsset} from "@/lib/types";
import {
  allRwaPairs,
  community,
  pairsForToken,
  communityPairs,
  rwaPairs,
  seriesFrom,
  socialsFrom,
  type DexPair,
} from "./dexscreener";
import {quotes, RWA_BY_ADDRESS, RWA_BY_TICKER, RWA_REGISTRY} from "./robinhood";
import {launchpadsFor} from "./launchpads";
import {holderRewardsFor} from "./holderRewards";
import {graduatedFrom} from "./graduation";
import {taxesFor} from "./taxes";
import {totalSupplies} from "./chain";

/**
 * The live market, in the shapes the UI already consumes.
 *
 * Two sources with a strict division of labour: Robinhood prices the stock
 * tokens, DexScreener prices the community tokens. Neither is allowed near the
 * other's job — the measurements in the runbook are what settled that.
 */

/**
 * Deep enough that the pool's own price history is worth drawing.
 *
 * Below this the shape is noise: on a $2k pool a single trade moves the line
 * further than a day of real price action does.
 */
const TRUSTED_POOL_LIQUIDITY_USD = 25_000;

function round(value: number, dp = 6): number {
  return Number(value.toFixed(dp));
}

/**
 * The deepest pool in which each stock token is the *base* asset.
 *
 * The base requirement is not a detail. DexScreener's `priceUsd` and
 * `priceChange` both describe the base token, so reading them off a pool where
 * the stock token is the quote side gives you the community token's numbers
 * wearing the stock's ticker — NVDA showed +78% that way, which was AI moving,
 * not NVDA.
 */
function deepestByTicker(pairs: DexPair[]): Map<string, DexPair> {
  const best = new Map<string, DexPair>();

  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    if (!base) continue;

    const entry = RWA_BY_ADDRESS.get(base);
    if (!entry) continue;

    const liq = pair.liquidity?.usd ?? 0;
    const held = best.get(entry.ticker);
    if (!held || liq > (held.liquidity?.usd ?? 0)) best.set(entry.ticker, pair);
  }

  return best;
}

export async function listRwas(): Promise<RwaAsset[]> {
  // Both discovery paths, because `tokens/v1` caps its response per token and
  // on its own it misses most of the pools a stock token actually trades in.
  const [quoteMap, rwaSide, chainSide] = await Promise.all([
    quotes(),
    rwaPairs(),
    communityPairs(),
  ]);

  const merged = new Map<string, DexPair>();
  for (const pair of [...rwaSide, ...chainSide]) merged.set(pair.pairAddress, pair);
  const deepest = deepestByTicker([...merged.values()]);

  // Supply straight from the chain, so market cap is the real quantity of the
  // instrument rather than whatever a pool happened to report. A pool's
  // `marketCap` is missing entirely for the many stock tokens with no deep
  // market, which is what left those rows reading $0.
  let supplies = new Map<string, number>();
  try {
    supplies = await totalSupplies(
      RWA_REGISTRY.map((entry) => ({address: entry.address, decimals: entry.decimals})),
    );
  } catch (error) {
    console.error("supply read failed; market caps will be omitted", error);
  }

  const out: RwaAsset[] = [];

  for (const entry of RWA_REGISTRY) {
    const quote = quoteMap.get(entry.ticker);
    if (!quote) continue; // no price, no row — never a placeholder

    const pool = deepest.get(entry.ticker);
    const liquid = (pool?.liquidity?.usd ?? 0) >= TRUSTED_POOL_LIQUIDITY_USD;

    // The sparkline is drawn only where a deep pool gives real history. On a
    // thin pool the shape is noise, and inventing one would be worse than the
    // blank the component already renders for an empty series.
    const series = pool && liquid ? seriesFrom(pool) : [];

    // Day change from the same deep pool, or from the day's range when there
    // is none. Never from a dust pool.
    const changePct =
      pool && liquid && typeof pool.priceChange?.h24 === "number"
        ? pool.priceChange.h24
        : 0;

    out.push({
      kind: "rwa",
      id: entry.ticker.toLowerCase(),
      ticker: entry.ticker,
      name: entry.name,
      logoUrl: entry.logoUrl,
      contractAddress: entry.address,
      verified: true,
      stockType: (entry.stockType as RwaAsset["stockType"]) ?? "stock",
      sector: (entry.sector as SectorId) ?? "software",
      description:
        entry.description ??
        `Tokenised debt security tracking ${entry.name}. Economic exposure, not ownership of shares.`,
      priceUsd: round(quote.priceUsd, 4),
      changePct: round(changePct, 2),
      volume24hUsd: Math.round(quote.volume24hUsd),
      // Token market cap: how much of this instrument exists on-chain. Not the
      // issuer's equity market cap, which this token is not a claim on.
      marketCapUsd: Math.round(
        (supplies.get(entry.address.toLowerCase()) ?? 0) * quote.priceUsd,
      ),
      series: series.map((v) => round(v, 4)),
    });
  }

  return out.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

/**
 * Whether a token must pair against a stock token to be listed.
 *
 * Measured 2 September 2026: 64 tradeable tokens, of which 29 pair against a
 * stock token — AI/NVDA alone turns over $31m a day — and 35 pair against USDG,
 * WETH or ETH.
 *
 * Left false so the feed carries both, each badged with what it actually trades
 * against. Set true to show only the RWA-paired 29, which is the stricter
 * reading of what this app is for.
 *
 * A caution learned the hard way here: DexScreener's `tokens/v1` endpoint caps
 * its response per token, so querying only the stock tokens returns their
 * deepest pools and hides the rest. That made it look like no community token
 * paired against an RWA. Discovery merges `tokens/v1` with search for exactly
 * that reason, and any future count taken from one endpoint alone will be wrong
 * the same way.
 */
const TOKENS_REQUIRE_RWA_PAIR = false;

/** Below this a pool is dust and the row is noise rather than a market. */
const MIN_TOKEN_LIQUIDITY_USD = 1_000;

export async function listTokens(): Promise<TokenAsset[]> {
  // The sweep is the complete set; the other two are kept because they also
  // surface tokens paired against a quote asset rather than a stock token.
  const [sweep, rwaSide, chainSide] = await Promise.all([
    allRwaPairs(),
    rwaPairs(),
    communityPairs(),
  ]);

  const pairs = new Map<string, DexPair>();
  for (const pair of [...sweep, ...rwaSide, ...chainSide]) {
    pairs.set(pair.pairAddress, pair);
  }

  // One row per token, from its deepest pool.
  const best = new Map<string, ReturnType<typeof community>>();

  for (const pair of pairs.values()) {
    const side = community(pair);
    if (!side) continue;
    if (TOKENS_REQUIRE_RWA_PAIR && !side.rwaPaired) continue;

    const liq = pair.liquidity?.usd ?? 0;
    if (liq < MIN_TOKEN_LIQUIDITY_USD) continue;

    const address = side.token.address.toLowerCase();
    const held = best.get(address);
    if (!held || liq > (held.pair.liquidity?.usd ?? 0)) best.set(address, side);
  }

  // One multicall each for the whole page rather than a lookup per row.
  const addresses = [...best.keys()];
  const [launchpads, payingHolders, graduated] = await Promise.all([
    launchpadsFor(addresses),
    holderRewardsFor(addresses),
    graduatedFrom(addresses),
  ]);

  const out: TokenAsset[] = [];

  for (const [address, side] of best) {
    if (!side) continue;
    const {pair, token, quoteSymbol} = side;

    const priceUsd = Number(pair.priceUsd ?? 0);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

    const series = seriesFrom(pair);
    const version = (pair.labels ?? [])[0] ?? pair.dexId;

    out.push({
      kind: "token",
      id: address,
      address,
      symbol: token.symbol,
      name: token.name,
      imageUrl: pair.info?.imageUrl ?? null,
      priceUsd: round(priceUsd, 10),
      changePct: round(pair.priceChange?.h24 ?? 0, 2),
      volume24hUsd: Math.round(pair.volume?.h24 ?? 0),
      windows: {
        "5m": {
          volumeUsd: Math.round(pair.volume?.m5 ?? 0),
          changePct: round(pair.priceChange?.m5 ?? 0, 2),
        },
        "1h": {
          volumeUsd: Math.round(pair.volume?.h1 ?? 0),
          changePct: round(pair.priceChange?.h1 ?? 0, 2),
        },
        "6h": {
          volumeUsd: Math.round(pair.volume?.h6 ?? 0),
          changePct: round(pair.priceChange?.h6 ?? 0, 2),
        },
        "24h": {
          volumeUsd: Math.round(pair.volume?.h24 ?? 0),
          changePct: round(pair.priceChange?.h24 ?? 0, 2),
        },
      },
      marketCapUsd: Math.round(pair.marketCap ?? pair.fdv ?? 0),
      liquidityUsd: Math.round(pair.liquidity?.usd ?? 0),
      // Real detection is Part 06 and needs an RPC. Zero means "not measured",
      // not "none" — the Rewards filter stays inert until that lands.
      rewards24hUsd: 0,
      rewardsToHolders: payingHolders.has(address),
      graduated: graduated.has(address),
      holders: 0,
      createdAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
      pairedTicker: quoteSymbol,
      rwaPaired: side.rwaPaired,
      // Measured per asset in `getAsset`, not here: it costs several calls a
      // token and is only ever read on a chart page.
      buyTaxPct: null,
      sellTaxPct: null,
      feeSplit: null,
      launchpad: launchpads.get(address) ?? null,
      socials: socialsFrom(pair),
      description: `${token.name} trades against ${quoteSymbol} on Uniswap ${version}.`,
      series: series.map((v) => round(v, 10)),
    });
  }

  return out.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

export async function getAsset(
  kind: "rwa" | "token",
  id: string,
): Promise<Asset | null> {
  const wanted = id.toLowerCase();

  if (kind === "rwa") {
    if (!RWA_BY_TICKER.has(wanted.toUpperCase())) return null;
    const all = await listRwas();
    return all.find((asset) => asset.id === wanted) ?? null;
  }

  const all = await listTokens();
  const asset =
    all.find(
      (asset) =>
        asset.id.toLowerCase() === wanted ||
        asset.symbol.toLowerCase() === wanted,
    ) ?? null;

  if (!asset) return null;

  // Tax is resolved here rather than in the feed: it costs a few calls per
  // token, and the figure is only ever read on this page. The pool is needed
  // because a Pons launch carries its tax on the pool rather than the token.
  const taxes = await taxesFor(
    asset.address,
    await poolIdsFor(asset.address),
    asset.launchpad?.id ?? null,
  );
  return {
    ...asset,
    buyTaxPct: taxes.buyPct,
    sellTaxPct: taxes.sellPct,
    feeSplit: taxes.split,
  };
}

/** Same ranking as the seeded search, over the live sets. */
export async function searchAssets(query: string): Promise<Asset[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [rwas, tokens] = await Promise.all([listRwas(), listTokens()]);
  const all: Asset[] = [...tokens, ...rwas];

  const score = (asset: Asset): number => {
    const symbol = (asset.kind === "rwa" ? asset.ticker : asset.symbol).toLowerCase();
    const address = (
      asset.kind === "rwa" ? asset.contractAddress : asset.address
    ).toLowerCase();
    const name = asset.name.toLowerCase();

    if (symbol === q) return 100;
    if (address.startsWith(q) && q.length >= 4) return 95;
    if (symbol.startsWith(q)) return 80;
    if (name.startsWith(q)) return 70;
    if (asset.kind === "token" && asset.pairedTicker.toLowerCase() === q) return 60;
    if (symbol.includes(q)) return 50;
    if (name.includes(q)) return 40;
    return 0;
  };

  return all
    .map((asset) => ({asset, score: score(asset)}))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.asset.volume24hUsd - a.asset.volume24hUsd)
    .slice(0, 40)
    .map((row) => row.asset);
}

/**
 * The pool an asset's chart and tape should read from, plus the token address
 * whose side of each swap we care about.
 *
 * Reuses the pair data already cached for the feed, so resolving this costs
 * nothing extra. GeckoTerminal and DexScreener agree on pool identifiers —
 * both use the pool address on v3 and the 32-byte pool id on v4 — so a pair
 * address from one is a valid pool for the other.
 */
export async function poolFor(
  kind: "rwa" | "token",
  id: string,
): Promise<{pool: string; token: string; quote: string} | null> {
  const wanted = id.toLowerCase();
  const [rwaSide, chainSide] = await Promise.all([rwaPairs(), communityPairs()]);
  const all = [...rwaSide, ...chainSide];

  if (kind === "rwa") {
    const entry = RWA_BY_TICKER.get(wanted.toUpperCase());
    if (!entry) return null;
    const address = entry.address.toLowerCase();

    // The complete pool set for this stock token. The feed's discovery pass is
    // capped, and picking from it sent whole tickers to the wrong pool or to
    // no pool at all — AAPL and SPY had no live pool in it and fell all the
    // way back to simulated trades on their own chart pages.
    const pools = await pairsForToken(address);
    const candidates = pools.length > 0 ? pools : all;

    // Base side only. `priceUsd` and a trade's buy/sell sense describe the
    // pair's base token, so reading a pool that quotes the other way round
    // reports the counterparty's trade, inverted.
    const deepest = candidates
      .filter((pair) => pair.baseToken?.address?.toLowerCase() === address)
      .reduce<DexPair | null>(
        (best, pair) =>
          !best || (pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)
            ? pair
            : best,
        null,
      );

    if (!deepest) return null;
    const quote = deepest.quoteToken?.address?.toLowerCase() ?? "";
    return {pool: deepest.pairAddress, token: address, quote};
  }

  // Resolve a symbol to its contract using the discovery pass, then ask
  // DexScreener for that contract's pools directly.
  const known = all
    .map(community)
    .find(
      (side) =>
        side &&
        (side.token.address.toLowerCase() === wanted ||
          side.token.symbol.toLowerCase() === wanted),
    );
  const address = known?.token.address.toLowerCase() ?? wanted;

  // The complete pool set for this token, not the subset discovery returned.
  // The deepest pool the feed pass happened to see is not always the deepest
  // one, and trades and candles have to come from a real market.
  const pools = await pairsForToken(address);
  const candidates = pools.length > 0 ? pools : all;

  const mine = candidates.filter((pair) => {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    return base === address || quote === address;
  });

  const againstStock = (pair: DexPair): boolean => {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    const other = base === address ? quote : base;
    return other ? RWA_BY_ADDRESS.has(other) : false;
  };

  // A token paired against a stock token is here *for* that pairing, so its
  // page shows that market even when a stablecoin pool is deeper. UBIK trades
  // more against USDG than against GLD, but GLD is the pair it exists for.
  // Tokens with no stock pair fall back to their deepest pool.
  const stockPairs = mine.filter(againstStock);
  const preferred = stockPairs.length > 0 ? stockPairs : mine;

  const deepest = preferred.reduce<DexPair | null>(
    (best, pair) =>
      !best || (pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)
        ? pair
        : best,
    null,
  );

  if (!deepest) return null;

  // The other side of the pool, needed to work out which of a swap's two
  // amounts belongs to this asset.
  const base = deepest.baseToken?.address?.toLowerCase();
  const quoteSide = deepest.quoteToken?.address?.toLowerCase();
  const quote = (base === address ? quoteSide : base) ?? "";

  return {pool: deepest.pairAddress, token: address, quote};
}

/**
 * Every pool id for a token, deepest first.
 *
 * The fee record for a launch lives on the pool the launchpad created, which
 * is not always the pool a trader would call the main one, so anything reading
 * launch config has to look across all of them.
 */
export async function poolIdsFor(address: string): Promise<string[]> {
  const wanted = address.toLowerCase();
  const pools = await pairsForToken(wanted);
  return pools
    .filter((pair) => {
      const base = pair.baseToken?.address?.toLowerCase();
      const quote = pair.quoteToken?.address?.toLowerCase();
      return base === wanted || quote === wanted;
    })
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
    .map((pair) => pair.pairAddress);
}
