import type {SectorId} from "@/lib/sectors";
import type {Asset, RwaAsset, TokenAsset} from "@/lib/types";
import {
  allRwaPairs,
  community,
  pairsForToken,
  communityPairs,
  poolsForKnownPayers,
  quotePairsFromMegafilter,
  rwaPairs,
  searchPairs,
  seriesFrom,
  socialsFrom,
  type CommunityToken,
  type DexPair,
} from "./dexscreener";
import {quotes, RWA_BY_ADDRESS, RWA_BY_TICKER, RWA_REGISTRY, type RegistryEntry} from "./robinhood";
import {launchpadsFor} from "./launchpads";
import {holderRewardsFor} from "./holderRewards";
import {graduatedFrom, marketProvesGraduated} from "./graduation";
import {taxesFor} from "./taxes";
import {totalSupplies} from "./chain";
import {cached, stale} from "./cache";
import {readShared} from "./shared";
import {tokenImages as geckoTokenImages, holderCountFor} from "./geckoterminal";
import {deployImagesFor} from "./deployImages";
import {allRewardPayingAddresses, rewardsFromDb} from "./rewards";
import {
  matchesSearchCategory,
  qualifiesForSearch,
  searchCategory,
} from "@/lib/searchable";
import {qualifiesForUniverse} from "@/lib/tokenUniverse";
import {hasDatabase} from "../db";
import {isAddress, normalizeAddress} from "@/lib/address";
import {showsThreeState} from "@/lib/threeState";
import {isListed} from "@/lib/universe";
import {
  getTokenBySymbol,
  getTokenRow,
  rowToAsset,
  statsFor,
} from "./universeStore";
import {loadDecoratedFeedPage} from "./feedDecorate";
import {feedImageUrl} from "@/lib/tokenImage";
import {looksInvertedMemecoin, usdPriceFor} from "@/lib/pairOrientation";
import {isTradeableFromLiquidity} from "@/lib/priceState";
import {marketCapAt} from "@/lib/marketCap";
import {resolveV4PoolKeys} from "./v4Pools";
import {resolveBestV3Pool} from "./v3Pools";

function storedPfp(url: string | null | undefined): string | null {
  return feedImageUrl({image_url: url ?? null});
}


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
const PFP_TTL_MS = 6 * 60 * 60_000;

function round(value: number, dp = 6): number {
  return Number(value.toFixed(dp));
}

async function readPersistedPfp(address: string): Promise<string | null> {
  const key = `token-pfp:${address}`;
  const local = stale<string>(key);
  if (local) return local;
  const shared = await readShared<string>(key);
  if (shared) {
    void cached(key, PFP_TTL_MS, async () => shared);
    return shared;
  }
  return null;
}

async function persistPfp(address: string, url: string): Promise<void> {
  await cached(`token-pfp:${address}`, PFP_TTL_MS, async () => url);
}

function isUniswapPool(pair: DexPair): boolean {
  const dex = (pair.dexId ?? "").toLowerCase();
  if (dex.includes("uniswap")) return true;
  return (pair.labels ?? []).some((label) => /v2|v3|v4/i.test(label));
}

function marketCapForToken(
  address: string,
  priceUsd: number,
  pair: DexPair,
  supplies: Map<string, number>,
): number {
  const supply = supplies.get(address);
  if (supply && supply > 0 && Number.isFinite(priceUsd)) {
    return Math.round(supply * priceUsd);
  }
  return Math.round(pair.marketCap ?? pair.fdv ?? 0);
}

function paysRwaRewardsFor(
  address: string,
  dbRewards: Set<string> | null,
  payingHolders: Set<string>,
): boolean {
  if (dbRewards === null || dbRewards.size === 0) {
    return payingHolders.has(address);
  }
  return dbRewards.has(address);
}

function wouldQualifyForUniverse(
  address: string,
  side: CommunityToken,
  launchpads: Map<string, TokenAsset["launchpad"]>,
  chainGraduated: Set<string>,
  payingHolders: Set<string>,
  dbRewards: Set<string> | null,
): boolean {
  const launchpad = launchpads.get(address) ?? null;
  const onChain = chainGraduated.has(address);
  const graduated =
    onChain ||
    (launchpad !== null &&
      side.rwaPaired &&
      marketProvesGraduated(side.pair, side.rwaPaired));
  if (!graduated || !isUniswapPool(side.pair)) return false;
  if (side.rwaPaired) return true;
  return (
    paysRwaRewardsFor(address, dbRewards, payingHolders) ||
    payingHolders.has(address)
  );
}

/**
 * Fully resolve PFPs for New-tab candidates before the general feed pass.
 */
async function ensureNewTabImages(
  candidates: string[],
  launchpads: Map<string, TokenAsset["launchpad"]>,
): Promise<void> {
  if (candidates.length === 0) return;

  const poolLists = await Promise.all(
    candidates.map((address) =>
      pairsForToken(address).catch(() => [] as DexPair[]),
    ),
  );

  await resolveTokenImages(candidates, poolLists.flat(), launchpads);
}

/**
 * DexScreener-updated profile from any pool of the token — not only the
 * RWA-paired one we list, which often has no `info` while a USDG pool does.
 */
function dexImagesFromPairs(pairs: Iterable<DexPair>): Map<string, string> {
  const images = new Map<string, string>();
  for (const pair of pairs) {
    const url = pair.info?.imageUrl?.trim();
    if (!url) continue;
    for (const raw of [pair.baseToken?.address, pair.quoteToken?.address]) {
      const address = raw?.toLowerCase();
      if (!address || RWA_BY_ADDRESS.has(address) || images.has(address)) {
        continue;
      }
      images.set(address, url);
    }
  }
  return images;
}

/**
 * Token PFP: DexScreener profile, then GeckoTerminal metadata, then the
 * image the creator uploaded at deploy. Never the launchpad's own brand mark.
 */
async function resolveTokenImages(
  addresses: string[],
  pairs: Iterable<DexPair>,
  launchpads: Map<string, TokenAsset["launchpad"]>,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();

  const persisted = await Promise.all(
    addresses.map(async (address) => {
      const url = await readPersistedPfp(address);
      return [address, url] as const;
    }),
  );
  for (const [address, url] of persisted) {
    if (url) images.set(address, url);
  }

  for (const [address, url] of dexImagesFromPairs(pairs)) {
    images.set(address, url);
  }

  let missing = addresses.filter((address) => !images.has(address));
  if (missing.length > 0) {
    const gecko = await geckoTokenImages(missing).catch(
      () => new Map<string, string>(),
    );
    for (const [address, url] of gecko) {
      if (!images.has(address)) images.set(address, url);
    }
  }

  let still = addresses.filter((address) => !images.has(address));
  if (still.length > 0) {
    const deploy = await deployImagesFor(still, launchpads).catch(
      () => new Map<string, {url: string}>(),
    );
    for (const [address, hit] of deploy) {
      if (!images.has(address)) images.set(address, hit.url);
    }
  }

  still = addresses.filter((address) => !images.has(address));
  const launchpadMissing = still.filter((address) => {
    const id = launchpads.get(address)?.id;
    return id === "pons" || id === "long";
  });
  if (launchpadMissing.length > 0) {
    const poolLists = await Promise.all(
      launchpadMissing.map((address) =>
        pairsForToken(address).catch(() => [] as DexPair[]),
      ),
    );
    for (const [address, url] of dexImagesFromPairs(poolLists.flat())) {
      if (!images.has(address)) images.set(address, url);
    }
    const stillLaunchpad = launchpadMissing.filter((a) => !images.has(a));
    if (stillLaunchpad.length > 0) {
      const deploy = await deployImagesFor(stillLaunchpad, launchpads).catch(
        () => new Map<string, {url: string}>(),
      );
      for (const [address, hit] of deploy) {
        if (!images.has(address)) images.set(address, hit.url);
      }
    }
  }

  await Promise.all(
    [...images.entries()].map(([address, url]) => persistPfp(address, url)),
  );

  return images;
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
  const [quoteSettled, rwaSettled, chainSettled] = await Promise.allSettled([
    quotes(),
    rwaPairs(),
    communityPairs(),
  ]);
  const quoteMap = quoteSettled.status === "fulfilled" ? quoteSettled.value : new Map();
  const rwaSide = rwaSettled.status === "fulfilled" ? rwaSettled.value : [];
  const chainSide = chainSettled.status === "fulfilled" ? chainSettled.value : [];
  if (quoteSettled.status === "rejected") {
    console.error("rwa quotes failed", quoteSettled.reason);
  }
  if (rwaSettled.status === "rejected") {
    console.error("rwa pairs failed", rwaSettled.reason);
  }
  if (chainSettled.status === "rejected") {
    console.error("rwa community pairs failed", chainSettled.reason);
  }

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
      circulatingSupply: supplies.get(entry.address.toLowerCase()) ?? null,
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

function pairAgainstStock(pair: DexPair, address: string): boolean {
  const base = pair.baseToken?.address?.toLowerCase();
  const quote = pair.quoteToken?.address?.toLowerCase();
  const other = base === address ? quote : base;
  return other ? RWA_BY_ADDRESS.has(other) : false;
}

/** True when any pool is paired against a tokenized stock. */
export function tokenHasStockPair(
  address: string,
  pairs: Iterable<DexPair>,
): boolean {
  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    if ((base === address || quote === address) && pairAgainstStock(pair, address)) {
      return true;
    }
  }
  return false;
}

/**
 * Deepest pool by USD liquidity. Stock preference is membership only
 * (`rwaPaired` / `tokenHasStockPair`) — not the price/chart/trades pool.
 */
export function deepestPoolForToken(
  address: string,
  pairs: Iterable<DexPair>,
): DexPair | null {
  const mine: DexPair[] = [];
  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    if (base === address || quote === address) mine.push(pair);
  }

  return mine.reduce<DexPair | null>(
    (best, pair) =>
      !best || (pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)
        ? pair
        : best,
    null,
  );
}

/**
 * Tokens HODL lists. Supabase is the universe. DexScreener only ever
 * decorated prices, and must not decide membership.
 */
export async function listTokens(): Promise<TokenAsset[]> {
  if (hasDatabase) {
    const page = await loadDecoratedFeedPage({sort: "trending", limit: 50});
    return page.tokens;
  }

  return listTokensFromProviders();
}

/** Only used when Supabase is unconfigured (local demo). */
async function listTokensFromProviders(): Promise<TokenAsset[]> {
  const knownPayers = await allRewardPayingAddresses();

  const [sweep, rwaSide, chainSide, quoteSide, payerPools] = await Promise.all([
    allRwaPairs(),
    rwaPairs(),
    communityPairs(),
    quotePairsFromMegafilter(),
    poolsForKnownPayers(knownPayers),
  ]);

  const pairs = new Map<string, DexPair>();
  for (const pair of [
    ...sweep,
    ...rwaSide,
    ...chainSide,
    ...quoteSide,
    ...payerPools,
  ]) {
    pairs.set(pair.pairAddress, pair);
  }

  // One row per token. Price comes from the deepest USD-liq pool.
  // `rwaPaired` is membership: any stock pair counts, even if a USDG pool is deeper.
  const best = new Map<string, CommunityToken>();
  const rwaPairedByAddress = new Map<string, boolean>();

  for (const pair of pairs.values()) {
    const side = community(pair);
    if (!side) continue;
    if (TOKENS_REQUIRE_RWA_PAIR && !side.rwaPaired) continue;

    const liq = pair.liquidity?.usd ?? 0;
    if (liq < MIN_TOKEN_LIQUIDITY_USD) continue;

    const address = side.token.address.toLowerCase();
    if (side.rwaPaired) rwaPairedByAddress.set(address, true);
    const held = best.get(address);
    if (!held || liq > (held.pair.liquidity?.usd ?? 0)) {
      best.set(address, side);
    }
  }

  const addresses = [...best.keys()];
  const launchpads = await launchpadsFor(addresses);
  const [payingHolders, chainGraduated, dbRewards] = await Promise.all([
    holderRewardsFor(addresses),
    graduatedFrom(addresses, new Set(launchpads.keys())),
    rewardsFromDb(addresses),
  ]);

  const universeCandidates = addresses.filter((address) => {
    const side = best.get(address);
    if (!side) return false;
    return wouldQualifyForUniverse(
      address,
      side,
      launchpads,
      chainGraduated,
      payingHolders,
      dbRewards,
    );
  });

  await ensureNewTabImages(universeCandidates, launchpads);

  const images = await resolveTokenImages(
    addresses,
    pairs.values(),
    launchpads,
  );

  let supplies = new Map<string, number>();
  try {
    supplies = await totalSupplies(
      addresses.map((address) => ({address, decimals: 18})),
    );
  } catch (error) {
    console.error("token supply read failed; falling back to pool FDV", error);
  }

  const out: TokenAsset[] = [];

  for (const [address, side] of best) {
    if (!side) continue;
    const {pair, token, quoteSymbol} = side;

    const priceUsd = usdPriceFor(
      {
        base: pair.baseToken?.address,
        quote: pair.quoteToken?.address,
        priceUsd: pair.priceUsd,
        priceNative: pair.priceNative,
      },
      address,
    ) ?? (side.tokenIsBase ? Number(pair.priceUsd ?? 0) : 0);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

    const series = seriesFrom(pair);
    const version = (pair.labels ?? [])[0] ?? pair.dexId;
    const launchpad = launchpads.get(address) ?? null;
    const onChain = chainGraduated.has(address);
    const rwaPaired = rwaPairedByAddress.get(address) ?? side.rwaPaired;
    const graduated =
      onChain ||
      (launchpad !== null &&
        rwaPaired &&
        marketProvesGraduated(pair, rwaPaired));
    const paysRwa = paysRwaRewardsFor(address, dbRewards, payingHolders);

    out.push({
      kind: "token",
      id: address,
      address,
      symbol: token.symbol,
      name: token.name,
      imageUrl: storedPfp(images.get(address)),
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
      marketCapUsd: marketCapForToken(address, priceUsd, pair, supplies),
      circulatingSupply: supplies.get(address) ?? null,
      liquidityUsd: Math.round(pair.liquidity?.usd ?? 0),
      tradeable: isTradeableFromLiquidity(pair.liquidity?.usd),
      // Real detection is Part 06 and needs an RPC. Zero means "not measured",
      // not "none" — the Rewards filter stays inert until that lands.
      rewards24hUsd: 0,
      rewardsToHolders: payingHolders.has(address),
      graduated,
      graduatedOnChain: onChain,
      tradesOnUniswap: isUniswapPool(pair),
      paysRwaRewards: paysRwa,
      holders: 0,
      createdAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
      listedAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
      pairedTicker: quoteSymbol,
      rwaPaired,
      // Measured per asset in `getAsset`, not here: it costs several calls a
      // token and is only ever read on a chart page.
      buyTaxPct: null,
      sellTaxPct: null,
      feeSplit: null,
      launchpad,
      socials: socialsFrom(pair),
      description: `${token.name} trades against ${quoteSymbol} on Uniswap ${version}.`,
      series: series.map((v) => round(v, 10)),
    });
  }

  const filtered = out
    .filter(qualifiesForUniverse)
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));

  logDiscoveryStats(pairs.size, addresses.length, filtered);

  return filtered;
}

function logDiscoveryStats(
  pairCount: number,
  addressCount: number,
  tokens: TokenAsset[],
): void {
  const universe = tokens.filter(qualifiesForUniverse);
  const rwaPaired = universe.filter((token) => token.rwaPaired).length;
  const quoteReward = universe.filter(
    (token) =>
      !token.rwaPaired &&
      (token.paysRwaRewards || token.rewardsToHolders),
  ).length;
  console.info(
    `listTokens discovery: pairs=${pairCount} addresses=${addressCount} universe=${universe.length} rwaPaired=${rwaPaired} quoteReward=${quoteReward}`,
  );
}

/** Builds one feed row from the deepest eligible pool for a token address. */
function tokenFromSide(
  address: string,
  side: CommunityToken,
  launchpads: Map<string, TokenAsset["launchpad"]>,
  payingHolders: Set<string>,
  chainGraduated: Set<string>,
  dbRewards: Set<string> | null,
  imageUrl: string | null,
  supplies: Map<string, number>,
): TokenAsset | null {
  const {pair, token, quoteSymbol} = side;

  const priceUsd =
    usdPriceFor(
      {
        base: pair.baseToken?.address,
        quote: pair.quoteToken?.address,
        priceUsd: pair.priceUsd,
        priceNative: pair.priceNative,
        quotePriceUsd: pair.quotePriceUsd,
      },
      address,
    ) ?? (side.tokenIsBase ? Number(pair.priceUsd ?? 0) : 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  if (looksInvertedMemecoin(priceUsd, pair.liquidity?.usd ?? 0)) {
    console.warn("inverted memecoin price hidden", {
      token: address,
      symbol: token.symbol,
      priceUsd,
      liquidityUsd: pair.liquidity?.usd ?? 0,
    });
    return null;
  }

  const series = seriesFrom(pair, address);
  const version = (pair.labels ?? [])[0] ?? pair.dexId;
  const launchpad = launchpads.get(address) ?? null;
  const onChain = chainGraduated.has(address);
  const graduated =
    onChain ||
    (launchpad !== null &&
      side.rwaPaired &&
      marketProvesGraduated(pair, side.rwaPaired));

  return {
    kind: "token",
    id: address,
    address,
    symbol: token.symbol,
    name: token.name,
    imageUrl,
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
    marketCapUsd: marketCapForToken(address, priceUsd, pair, supplies),
    circulatingSupply: supplies.get(address) ?? null,
    liquidityUsd: Math.round(pair.liquidity?.usd ?? 0),
    tradeable: isTradeableFromLiquidity(pair.liquidity?.usd),
    rewards24hUsd: 0,
    rewardsToHolders: payingHolders.has(address),
    graduated,
    graduatedOnChain: onChain,
    tradesOnUniswap: isUniswapPool(pair),
    paysRwaRewards: paysRwaRewardsFor(address, dbRewards, payingHolders),
    holders: 0,
    createdAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
    listedAt: new Date(pair.pairCreatedAt ?? Date.now()).toISOString(),
    pairedTicker: quoteSymbol,
    rwaPaired: side.rwaPaired,
    buyTaxPct: null,
    sellTaxPct: null,
    feeSplit: null,
    launchpad: launchpad,
    socials: socialsFrom(pair),
    description: `${token.name} trades against ${quoteSymbol} on Uniswap ${version}.`,
    series: series.map((v) => round(v, 10)),
  };
}

/** Deepest eligible pool for one token address. */
function bestPoolForToken(
  address: string,
  pools: DexPair[],
  discovery: DexPair[],
): CommunityToken | null {
  const candidates = pools.length > 0 ? pools : discovery;
  const deepest = deepestPoolForToken(address, candidates);
  const side = deepest ? community(deepest) : null;
  if (!side) return null;
  return {
    ...side,
    rwaPaired: side.rwaPaired || tokenHasStockPair(address, candidates),
  };
}

async function resolveTokenAddress(wanted: string): Promise<string | null> {
  if (/^0x[a-f0-9]{40}$/.test(wanted)) return wanted;

  const [rwaSide, chainSide, sweep] = await Promise.all([
    rwaPairs(),
    communityPairs(),
    allRwaPairs(),
  ]);
  const discovery = [...rwaSide, ...chainSide, ...sweep];

  const match = discovery
    .map(community)
    .find(
      (side) =>
        side &&
        (side.token.address.toLowerCase() === wanted ||
          side.token.symbol.toLowerCase() === wanted),
    );

  return match?.token.address.toLowerCase() ?? null;
}

async function buildRwaAsset(entry: RegistryEntry): Promise<RwaAsset | null> {
  const address = entry.address.toLowerCase();

  const [quoteMap, pools, supplies] = await Promise.all([
    quotes(),
    pairsForToken(address),
    totalSupplies([{address: entry.address, decimals: entry.decimals}]).catch(
      () => new Map<string, number>(),
    ),
  ]);

  const quote = quoteMap.get(entry.ticker);
  if (!quote) return null;

  const deepest = pools
    .filter((pair) => pair.baseToken?.address?.toLowerCase() === address)
    .reduce<DexPair | null>(
      (best, pair) =>
        !best || (pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)
          ? pair
          : best,
      null,
    );

  const liquid = (deepest?.liquidity?.usd ?? 0) >= TRUSTED_POOL_LIQUIDITY_USD;
  const series = deepest && liquid ? seriesFrom(deepest) : [];
  const changePct =
    deepest && liquid && typeof deepest.priceChange?.h24 === "number"
      ? deepest.priceChange.h24
      : 0;

  return {
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
    marketCapUsd: Math.round(
      (supplies.get(address) ?? 0) * quote.priceUsd,
    ),
    circulatingSupply: supplies.get(address) ?? null,
    series: series.map((v) => round(v, 4)),
  };
}

async function decorateFromProviders(asset: TokenAsset): Promise<TokenAsset> {
  try {
    const [pools, holders] = await Promise.all([
      pairsForToken(asset.address),
      holderCountFor(asset.address).catch(() => 0),
    ]);
    const deepest = deepestPoolForToken(asset.address, pools);
    if (!deepest) return {...asset, holders};
    const liquidityUsd = Math.round(
      deepest.liquidity?.usd ?? asset.liquidityUsd ?? 0,
    );
    const oriented = usdPriceFor(
      {
        base: deepest.baseToken?.address,
        quote: deepest.quoteToken?.address,
        priceUsd: deepest.priceUsd,
        priceNative: deepest.priceNative,
        quotePriceUsd: deepest.quotePriceUsd,
      },
      asset.address,
    );
    if (oriented != null && looksInvertedMemecoin(oriented, liquidityUsd)) {
      console.warn("inverted memecoin price hidden", {
        token: asset.address,
        symbol: asset.symbol,
        priceUsd: oriented,
        liquidityUsd,
      });
      return {
        ...asset,
        holders,
        liquidityUsd,
        tradeable: isTradeableFromLiquidity(liquidityUsd),
      };
    }
    const series = seriesFrom(deepest, asset.address);
    const priceUsd =
      oriented != null && oriented > 0 ? round(oriented, 10) : asset.priceUsd;
    const marketCapUsd =
      priceUsd != null && priceUsd > 0
        ? marketCapAt({...asset, priceUsd}, priceUsd)
        : asset.marketCapUsd;
    return {
      ...asset,
      holders,
      priceUsd,
      marketCapUsd,
      changePct: round(deepest.priceChange?.h24 ?? asset.changePct, 2),
      volume24hUsd: Math.round(deepest.volume?.h24 ?? asset.volume24hUsd ?? 0),
      liquidityUsd,
      tradeable: isTradeableFromLiquidity(liquidityUsd),
      rwaPaired: asset.rwaPaired || tokenHasStockPair(asset.address, pools),
      imageUrl: asset.imageUrl,
      series: series.length > 0 ? series.map((value) => round(value, 10)) : asset.series,
    };
  } catch (error) {
    console.error("token page decorate failed; serving store row", error);
    return asset;
  }
}

async function loadStoredToken(wanted: string): Promise<TokenAsset | null> {
  const row = isAddress(wanted)
    ? await getTokenRow(wanted)
    : await getTokenBySymbol(wanted);
  if (!row?.launchpad || !showsThreeState(row.eligible)) return null;
  if (
    row.eligible != null &&
    !isListed({
      launchpad: row.launchpad,
      quoteKind: row.quote_kind,
      rewardRwa: row.reward_rwa,
      bonded: Boolean(row.bonded_at) || row.launchpad === "long",
    })
  ) {
    return null;
  }
  const stats = await statsFor([row.address]);
  return rowToAsset(row, stats.get(normalizeAddress(row.address)));
}

async function buildTokenAsset(wanted: string): Promise<TokenAsset | null> {
  const address = await resolveTokenAddress(wanted);
  if (!address) return null;

  const [pools, rwaSide, chainSide, launchpads, payingHolders, chainGraduated, dbRewards, supplies] =
    await Promise.all([
      pairsForToken(address),
      rwaPairs(),
      communityPairs(),
      launchpadsFor([address]),
      holderRewardsFor([address]),
      graduatedFrom([address]),
      rewardsFromDb([address]),
      totalSupplies([{address, decimals: 18}]).catch(() => new Map<string, number>()),
    ]);

  const side = bestPoolForToken(address, pools, [...rwaSide, ...chainSide]);
  if (!side) return null;

  const images = await resolveTokenImages(
    [address],
    [...pools, ...rwaSide, ...chainSide],
    launchpads,
  );

  const [asset, holders] = await Promise.all([
    Promise.resolve(
      tokenFromSide(
        address,
        side,
        launchpads,
        payingHolders,
        chainGraduated,
        dbRewards,
        storedPfp(images.get(address)),
        supplies,
      ),
    ),
    holderCountFor(address).catch(() => 0),
  ]);

  if (!asset) return null;
  return {...asset, holders};
}

async function loadAsset(
  kind: "rwa" | "token",
  id: string,
): Promise<Asset | null> {
  const wanted = kind === "token" ? normalizeAddress(id) : id.toLowerCase();

  if (kind === "rwa") {
    const entry = RWA_BY_TICKER.get(wanted.toUpperCase());
    if (!entry) return null;
    return buildRwaAsset(entry);
  }

  const asset = hasDatabase
    ? await loadStoredToken(wanted)
    : await buildTokenAsset(wanted);
  if (!asset) return null;
  const decorated = hasDatabase ? await decorateFromProviders(asset) : asset;

  // Tax is resolved here rather than in the feed: it costs a few calls per
  // token, and the figure is only ever read on this page. The pool is needed
  // because a Pons launch carries its tax on the pool rather than the token.
  const taxes = await taxesFor(
    decorated.address,
    await poolIdsFor(decorated.address),
    decorated.launchpad?.id ?? null,
  );
  return {
    ...decorated,
    buyTaxPct: taxes.buyPct,
    sellTaxPct: taxes.sellPct,
    feeSplit: taxes.split,
  };
}

export async function getAsset(
  kind: "rwa" | "token",
  id: string,
): Promise<Asset | null> {
  return cached(
    `asset:${kind}:${kind === "token" ? normalizeAddress(id) : id.toLowerCase()}`,
    10_000,
    () => loadAsset(kind, id),
  );
}

const SEARCH_INDEX_TTL_MS = 60_000;

/** RWA universe tokens for search. */
export async function searchableTokens(): Promise<TokenAsset[]> {
  return cached("market:search-index", SEARCH_INDEX_TTL_MS, async () => {
    const tokens = await listTokens();
    return tokens.filter(qualifiesForSearch);
  });
}

/**
 * Words in a name, for matching a query against part of a company.
 *
 * "apple inc" and "adobe systems" both scored zero against names of "Apple"
 * and "Adobe", because matching was prefix-or-substring against the whole
 * string: a query longer than the name could never match it, however much of
 * the name it contained. Splitting both sides lets the overlap be seen.
 */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Words that identify a company form rather than the company.
 *
 * Left in, they match the wrong thing: "apple inc" scored the same against
 * MicroStrategy Inc as against Apple, and the tie went to whichever had more
 * volume — so the company actually asked for came second to one that shared
 * nothing with the query but its suffix.
 */
const CORPORATE_WORDS = new Set([
  "inc",
  "inc.",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "llc",
  "lp",
  "sa",
  "nv",
  "ag",
  "holdings",
  "holding",
  "group",
  "the",
  "stock",
  "shares",
  "token",
  // Share-class qualifiers. The registry names Alphabet "Alphabet Class A",
  // and counting those three words equally meant the query "alphabet"
  // described a third of the name — scoring it below a community token that
  // had simply named itself Alphabet.
  "class",
  "series",
  "ordinary",
  "common",
  "adr",
  "a",
  "b",
  "c",
]);

/**
 * How much of the query the name accounts for, from 0 to 1.
 *
 * Every distinctive query word has to appear as a word of the name, or as the
 * start of one, so "apple inc" matches "Apple Inc." and "app" matches "Apple",
 * while "apple pie" matches neither.
 */
function nameOverlap(name: string, q: string): {asked: number; name: number} {
  const asked = words(q).filter((word) => !CORPORATE_WORDS.has(word));
  if (asked.length === 0) return {asked: 0, name: 0};

  const have = words(name).filter((word) => !CORPORATE_WORDS.has(word));
  if (have.length === 0) return {asked: 0, name: 0};

  const matched = asked.filter((word) =>
    have.some((part) => part === word || part.startsWith(word)),
  ).length;

  // How much of the *name* the query accounts for matters as much as the other
  // direction. "apple" fully describes Apple and half-describes Apple Cat, and
  // without that second measure the two tied and the tie went to whichever had
  // more volume — which put a meme token above the company it is named after.
  const covered = have.filter((part) =>
    asked.some((word) => part === word || part.startsWith(word)),
  ).length;

  return {asked: matched / asked.length, name: covered / have.length};
}

function scoreAsset(asset: Asset, q: string): number {
  const symbol = (asset.kind === "rwa" ? asset.ticker : asset.symbol).toLowerCase();
  const address = (
    asset.kind === "rwa" ? asset.contractAddress : asset.address
  ).toLowerCase();
  const name = asset.name.toLowerCase();

  if (symbol === q) return 100;
  if (address === q) return 98;
  if (address.startsWith(q) && q.length >= 4) return 95;
  if (symbol.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;

  // Every word of the query is a word of the name: "apple inc" finding Apple,
  // "advanced micro" finding AMD's registry name.
  const overlap = nameOverlap(name, q);
  // The query accounts for the whole name and the name for the whole query —
  // this is the company being asked for, not one that merely contains it.
  if (overlap.asked === 1 && overlap.name === 1) return 75;
  if (overlap.asked === 1) return 68;
  if (asset.kind === "token") {
    if (asset.launchpad?.id === q) return 75;
    if (
      (q === "rewards" || q === "reward") &&
      (asset.paysRwaRewards || asset.rewardsToHolders)
    ) {
      return 70;
    }
    if (q === "rwa" && asset.rwaPaired && asset.graduated) return 65;
    if (asset.pairedTicker.toLowerCase() === q) return 60;
  }
  if (symbol.includes(q)) return 50;
  if (name.includes(q)) return 40;
  // Most of a multi-word query landing on the name still beats nothing.
  if (overlap.asked >= 0.5) return 35;
  return 0;
}

/** Official stock tokens sort ahead of community tokens on an equal match. */
function rankOfKind(asset: Asset): number {
  return asset.kind === "rwa" ? 0 : 1;
}

function rankAssets(assets: Asset[], q: string): Asset[] {
  return assets
    .map((asset) => ({asset, score: scoreAsset(asset, q)}))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // On an equal match, the official tokenised stock comes first. The
        // chain is full of community tokens named after companies — searching
        // "alphabet" matched both Alphabet and a meme token calling itself
        // that, and volume broke the tie for the meme. Someone typing a
        // company name is asking for the company.
        rankOfKind(a.asset) - rankOfKind(b.asset) ||
        (b.asset.volume24hUsd ?? 0) - (a.asset.volume24hUsd ?? 0),
    )
    .map((row) => row.asset);
}

function alreadyHas(assets: Asset[], id: string): boolean {
  const wanted = normalizeAddress(id);
  return assets.some(
    (asset) =>
      (asset.kind === "token" && normalizeAddress(asset.address) === wanted) ||
      asset.id.toLowerCase() === id.toLowerCase() ||
      (asset.kind === "rwa" && asset.contractAddress.toLowerCase() === id.toLowerCase()),
  );
}

/**
 * Tokens DexScreener knows that the feed lists never built — a pasted
 * contract, or a name that sits under the liquidity floor.
 *
 * Address hits are always merged. A text query only goes to DexScreener when
 * the scored feed list is empty, so a ticker that already matches NVDA does
 * not also spend a search round trip.
 */
/**
 * Stock tokens the live list dropped, recovered from the registry.
 *
 * `listRwas` skips any ticker whose quote it could not fetch — deliberately,
 * because a feed row with no price is worse than no row. But identity does not
 * come from the quote: which stocks exist, and what they are called, is in the
 * registry and is always available. Applying the feed's rule to search meant a
 * dropped quote made a company unfindable by any spelling of its name, which
 * is how Alphabet came to be missing from search entirely while Adobe and
 * Apple beside it were fine.
 *
 * Matched against the registry, then resolved individually — one ticker's
 * quote can succeed where the bulk fetch dropped it. Nothing is invented: a
 * ticker that still cannot be priced is still left out.
 */
async function registryHits(q: string, present: RwaAsset[]): Promise<Asset[]> {
  const have = new Set(present.map((asset) => asset.ticker.toUpperCase()));

  const wanted = RWA_REGISTRY.filter((entry) => {
    if (have.has(entry.ticker.toUpperCase())) return false;
    const ticker = entry.ticker.toLowerCase();
    if (ticker === q || ticker.startsWith(q)) return true;
    const name = entry.name.toLowerCase();
    if (name.startsWith(q) || name.includes(q)) return true;
    return nameOverlap(entry.name, q).asked === 1;
  })
    // Bounded: a one-letter query matches a great many names, and each of
    // these is a quote fetch.
    .slice(0, 5);

  if (wanted.length === 0) return [];

  const hits = await Promise.all(
    wanted.map((entry) => getAsset("rwa", entry.ticker).catch(() => null)),
  );
  return hits.filter((hit): hit is RwaAsset => hit !== null);
}

async function extraSearchHits(
  q: string,
  already: Asset[],
  isAddress: boolean,
): Promise<Asset[]> {
  if (isAddress) {
    if (alreadyHas(already, q)) return [];
    const hit = await getAsset("token", q).catch(() => null);
    return hit ? [hit] : [];
  }

  const pairs = await searchPairs(q);
  const seen = new Set(
    already
      .filter((asset): asset is TokenAsset => asset.kind === "token")
      .map((asset) => asset.address),
  );
  const wanted: string[] = [];
  for (const pair of pairs) {
    const side = community(pair);
    if (!side) continue;
    const address = side.token.address.toLowerCase();
    if (seen.has(address) || wanted.includes(address)) continue;
    wanted.push(address);
    if (wanted.length >= 20) break;
  }

  const hits = await Promise.all(
    wanted.map((id) => getAsset("token", id).catch(() => null)),
  );
  return hits.filter((hit): hit is TokenAsset => hit !== null);
}

function mergeUnique(assets: Asset[]): Asset[] {
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    out.push(asset);
  }
  return out;
}

/** Same ranking as the seeded search, over the live sets. */
export async function searchAssets(query: string): Promise<Asset[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const category = searchCategory(q);
  const [rwas, tokens, searchable] = await Promise.all([
    listRwas(),
    listTokens(),
    searchableTokens(),
  ]);

  let pool: Asset[] = [...tokens, ...rwas];

  if (category) {
    // The category slice leads, but anything that matches the word normally
    // follows it. Searching "long" returned only Long's launches and could
    // never reach a token whose symbol is LONG; "rwa" could reach nothing at
    // all. A category is a strong signal about intent, not proof of it.
    const members = searchable
      .filter((token) => matchesSearchCategory(token, category))
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, 100);

    const byName = rankAssets(pool, q).filter(
      (asset) => !members.some((member) => member.id === asset.id),
    );

    return mergeUnique([...members, ...byName]).slice(0, 100);
  }

  const indexHits = searchable.filter((token) => scoreAsset(token, q) > 0);
  pool = mergeUnique([...pool, ...indexHits, ...(await registryHits(q, rwas))]);

  const scored = rankAssets(pool, q).slice(0, 40);
  const qIsAddress = isAddress(q);
  if (!qIsAddress && scored.length > 0) return scored;

  const extras = await extraSearchHits(q, scored, qIsAddress);
  if (extras.length === 0) return scored;

  const merged = mergeUnique([...scored, ...extras]);
  const ranked = rankAssets(merged, q);

  if (qIsAddress) {
    const hit = extras[0];
    if (hit && !ranked.some((asset) => asset.id === hit.id)) {
      return mergeUnique([hit, ...ranked]).slice(0, 40);
    }
    return ranked;
  }
  return ranked.slice(0, 40);
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
async function resolvePoolFor(
  kind: "rwa" | "token",
  id: string,
): Promise<{pool: string; token: string; quote: string; tokenIsBase?: boolean} | null> {
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
    return {pool: deepest.pairAddress, token: address, quote, tokenIsBase: true};
  }

  // Resolve a symbol to its contract using the discovery pass, then ask
  // DexScreener for that contract's pools directly.
  //
  // Do not prefer tokens.pool_address here. That column is the deepest
  // *V3* pool; the liquid market is often a V4 pool DexScreener already
  // ranks higher (STACK, AI, SPACEHOOD). Pointing the chart at V3 made
  // those three worse — see the A–E report.
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

  const deepest = deepestPoolForToken(address, candidates);

  if (!deepest) return onchainPoolFor(address);

  // The other side of the pool, needed to work out which of a swap's two
  // amounts belongs to this asset.
  const base = deepest.baseToken?.address?.toLowerCase();
  const quoteSide = deepest.quoteToken?.address?.toLowerCase();
  const quote = (base === address ? quoteSide : base) ?? "";

  return {pool: deepest.pairAddress, token: address, quote, tokenIsBase: base === address};
}

/**
 * Pool from the launchpad factory when DexScreener and Gecko have no pair.
 *
 * Read-only `eth_call`. Does not write tokens, cursors, or images.
 */
async function onchainPoolFor(
  address: string,
): Promise<{pool: string; token: string; quote: string; tokenIsBase?: boolean} | null> {
  try {
    const v4 = await resolveV4PoolKeys({token: address});
    const hit = v4[0];
    if (hit) {
      return {
        pool: hit.poolId,
        token: address,
        quote: hit.quote,
        tokenIsBase: hit.tokenIsCurrency0,
      };
    }
  } catch (error) {
    console.error("on-chain v4 pool resolve failed", error);
  }

  try {
    const v3 = await resolveBestV3Pool(address);
    if (v3) {
      const token = address.toLowerCase();
      const quote = v3.quote.toLowerCase();
      return {
        pool: v3.pool,
        token,
        quote,
        tokenIsBase: token < quote,
      };
    }
  } catch (error) {
    console.error("on-chain v3 pool resolve failed", error);
  }

  return null;
}

export async function poolFor(
  kind: "rwa" | "token",
  id: string,
): Promise<{pool: string; token: string; quote: string; tokenIsBase?: boolean} | null> {
  return cached(`pool:${kind}:${id.toLowerCase()}`, 15_000, () =>
    resolvePoolFor(kind, id),
  );
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
