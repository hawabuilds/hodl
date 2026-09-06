import type {TokenAsset} from "@/lib/types";
import {pairsForAddresses, seriesFrom, type DexPair} from "./dexscreener";
import {looksInvertedMemecoin, usdPriceFor} from "@/lib/pairOrientation";
import {
  listTokensPage,
  rowToAsset,
  upsertStats,
  type TokenPageQuery,
} from "./universeStore";
import {isTradeableFromLiquidity, rowPassesFeedBounds} from "@/lib/priceState";
import {marketCapAt} from "@/lib/marketCap";

function round(value: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function deepestForToken(pairs: DexPair[], wanted: Set<string>): Map<string, DexPair> {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    const token = wanted.has(base ?? "") ? base : wanted.has(quote ?? "") ? quote : null;
    if (!token) continue;
    const held = best.get(token);
    if (!held || (pair.liquidity?.usd ?? 0) > (held.liquidity?.usd ?? 0)) {
      best.set(token, pair);
    }
  }
  return best;
}

/**
 * Overlay DexScreener stats onto a store row.
 *
 * Membership and artwork already came from the store. This only fills price,
 * cap, volume and 24h change. It must never write or clear image_url —
 * a Dex 429 is not "this token has no logo".
 */
export function applyDexPair(asset: TokenAsset, pair: DexPair): TokenAsset {
  const oriented = usdPriceFor(
    {
      base: pair.baseToken?.address,
      quote: pair.quoteToken?.address,
      priceUsd: pair.priceUsd,
      priceNative: pair.priceNative,
      quotePriceUsd: pair.quotePriceUsd,
    },
    asset.address,
  );
  const raw = pair.priceUsd != null ? Number(pair.priceUsd) : null;
  const tokenIsQuote =
    pair.quoteToken?.address?.toLowerCase() === asset.address.toLowerCase();
  const measuredLiq =
    pair.liquidity?.usd != null && Number.isFinite(pair.liquidity.usd)
      ? pair.liquidity.usd
      : null;
  const liquidityUsd =
    measuredLiq != null ? Math.round(measuredLiq) : asset.liquidityUsd;
  const tradeable =
    measuredLiq != null
      ? isTradeableFromLiquidity(measuredLiq)
      : asset.tradeable;
  let priceUsd = oriented ?? (tokenIsQuote || raw == null || raw <= 0 ? null : raw);
  if (
    priceUsd != null &&
    priceUsd > 0 &&
    looksInvertedMemecoin(priceUsd, liquidityUsd ?? 0)
  ) {
    console.warn("inverted memecoin price hidden", {
      token: asset.address,
      symbol: asset.symbol,
      priceUsd,
      liquidityUsd,
    });
    priceUsd = null;
  }
  const price =
    priceUsd != null && Number.isFinite(priceUsd) && priceUsd > 0
      ? priceUsd
      : asset.priceUsd;
  const changePct =
    typeof pair.priceChange?.h24 === "number"
      ? pair.priceChange.h24
      : asset.changePct;
  const volume24hUsd =
    pair.volume?.h24 != null
      ? Math.round(pair.volume.h24)
      : asset.volume24hUsd;
  const supply = asset.circulatingSupply;
  const providerCap = pair.marketCap ?? pair.fdv;
  const fromSupply =
    price != null && price > 0
      ? marketCapAt({...asset, priceUsd: price}, price)
      : asset.marketCapUsd;
  const marketCapUsd =
    supply && price != null && price > 0
      ? fromSupply
      : tokenIsQuote
        ? asset.marketCapUsd
        : providerCap != null
          ? Math.round(Number(providerCap))
          : fromSupply;
  const series = seriesFrom(pair, asset.address);

  return {
    ...asset,
    priceUsd: price != null ? round(price, 10) : null,
    changePct: round(changePct, 2),
    volume24hUsd,
    liquidityUsd,
    tradeable,
    marketCapUsd,
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
        volumeUsd: volume24hUsd ?? 0,
        changePct: round(changePct, 2),
      },
    },
    series: series.length > 0 ? series.map((value) => round(value, 10)) : asset.series,
  };
}

/**
 * Decorate a listed page from DexScreener. Does not decide who is in the list.
 *
 * Persists stats so the next cold read does not depend on opening each token
 * page. Image writes stay in the background so the feed is not held up by them.
 */
export async function decorateTokenAssets(
  assets: TokenAsset[],
): Promise<TokenAsset[]> {
  if (assets.length === 0) return assets;

  const wanted = new Set(assets.map((asset) => asset.address.toLowerCase()));
  let pairs: DexPair[] = [];
  try {
    pairs = await pairsForAddresses([...wanted]);
  } catch (error) {
    console.error("feed decorate pairs failed; serving stored rows", error);
    return assets;
  }
  const best = deepestForToken(pairs, wanted);

  const stats: {
    address: string;
    last_price: number | null;
    last_mcap: number | null;
    liquidity_usd: number | null;
    vol_24h: number | null;
    price_change_24h: number | null;
    priced_at: string;
    price_status: "priced";
  }[] = [];

  const out: TokenAsset[] = assets.map((asset) => {
    const pair = best.get(asset.address.toLowerCase());
    if (!pair) return asset;
    const decorated = applyDexPair(asset, pair);
    if (decorated.priceUsd != null && decorated.priceUsd > 0) {
      stats.push({
        address: decorated.address,
        last_price: decorated.priceUsd,
        last_mcap:
          decorated.marketCapUsd != null && decorated.marketCapUsd > 0
            ? decorated.marketCapUsd
            : null,
        liquidity_usd: decorated.liquidityUsd || null,
        vol_24h: decorated.volume24hUsd || null,
        price_change_24h: decorated.changePct,
        priced_at: new Date().toISOString(),
        price_status: "priced",
      });
    }
    return decorated;
  });

  try {
    await upsertStats(stats);
  } catch (error) {
    console.error("feed decorate stats persist failed", error);
  }

  return out;
}

/**
 * Decorate the page the user is looking at — not a global top-N.
 * New = listed_at. Trending = volume. Each tab owns its own page.
 */
export async function loadDecoratedFeedPage(query: TokenPageQuery): Promise<{
  tokens: TokenAsset[];
  cursor: string | null;
  hasMore: boolean;
  decorateMs: number;
}> {
  const page = await listTokensPage(query);
  const started = Date.now();
  let decorated: TokenAsset[];
  try {
    decorated = await decorateTokenAssets(
      page.rows.map((row) => rowToAsset(row, page.stats.get(row.address.toLowerCase()))),
    );
  } catch (error) {
    console.error("feed decorate failed; serving stored rows", error);
    decorated = page.rows.map((row) =>
      rowToAsset(row, page.stats.get(row.address.toLowerCase())),
    );
  }
  const tokens = decorated.filter((token) =>
    rowPassesFeedBounds({
      mcap: token.marketCapUsd,
      liq: token.liquidityUsd,
      tradeable: token.tradeable,
      volume: token.volume24hUsd,
      createdAt: token.createdAt,
      minMarketCap: query.minMarketCap,
      maxMarketCap: query.maxMarketCap,
      minLiquidity: query.minLiquidity,
      maxLiquidity: query.maxLiquidity,
      minVolume: query.minVolume,
      maxVolume: query.maxVolume,
      minAgeHours: query.minAgeHours,
      maxAgeHours: query.maxAgeHours,
    }),
  );
  return {
    tokens,
    cursor: page.next,
    hasMore: Boolean(page.next),
    decorateMs: Date.now() - started,
  };
}
