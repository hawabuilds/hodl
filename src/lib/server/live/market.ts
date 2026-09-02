import type {SectorId} from "@/lib/sectors";
import type {Asset, RwaAsset, TokenAsset} from "@/lib/types";
import {
  community,
  communityPairs,
  rwaPairs,
  seriesFrom,
  socialsFrom,
  type DexPair,
} from "./dexscreener";
import {quotes, RWA_BY_ADDRESS, RWA_BY_TICKER, RWA_REGISTRY} from "./robinhood";
import {launchpadFor} from "../universe";
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
  const [rwaSide, chainSide] = await Promise.all([rwaPairs(), communityPairs()]);

  const pairs = new Map<string, DexPair>();
  for (const pair of [...rwaSide, ...chainSide]) pairs.set(pair.pairAddress, pair);

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
      marketCapUsd: Math.round(pair.marketCap ?? pair.fdv ?? 0),
      liquidityUsd: Math.round(pair.liquidity?.usd ?? 0),
      // Real detection is Part 06 and needs an RPC. Zero means "not measured",
      // not "none" — the Rewards filter stays inert until that lands.
      rewards24hUsd: 0,
      holders: 0,
      createdAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
      pairedTicker: quoteSymbol,
      // Transfer taxes need simulation against an RPC. Part 05 step 4.
      buyTaxPct: 0,
      sellTaxPct: 0,
      launchpad: launchpadFor(version === "v4" ? "rhpad" : "tickerhouse", address),
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
  return (
    all.find(
      (asset) =>
        asset.id.toLowerCase() === wanted ||
        asset.symbol.toLowerCase() === wanted,
    ) ?? null
  );
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
): Promise<{pool: string; token: string} | null> {
  const wanted = id.toLowerCase();
  const [rwaSide, chainSide] = await Promise.all([rwaPairs(), communityPairs()]);
  const all = [...rwaSide, ...chainSide];

  if (kind === "rwa") {
    const entry = RWA_BY_TICKER.get(wanted.toUpperCase());
    if (!entry) return null;
    const deepest = deepestByTicker(all).get(entry.ticker);
    return deepest
      ? {pool: deepest.pairAddress, token: entry.address.toLowerCase()}
      : null;
  }

  let best: {pool: string; liq: number} | null = null;
  for (const pair of all) {
    const side = community(pair);
    if (!side) continue;
    const address = side.token.address.toLowerCase();
    if (address !== wanted && side.token.symbol.toLowerCase() !== wanted) continue;
    const liq = pair.liquidity?.usd ?? 0;
    if (!best || liq > best.liq) best = {pool: pair.pairAddress, liq};
  }

  if (!best) return null;
  const token = all
    .map(community)
    .find(
      (side) =>
        side &&
        (side.token.address.toLowerCase() === wanted ||
          side.token.symbol.toLowerCase() === wanted),
    );
  return token ? {pool: best.pool, token: token.token.address.toLowerCase()} : null;
}
