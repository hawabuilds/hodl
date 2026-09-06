import type {Launchpad} from "@/lib/types";
import type {TokenAsset} from "@/lib/types";
import type {LaunchpadId, QuoteKind, TokenStatus} from "@/lib/universe";
import {isListed, qualifiesForUniverse} from "@/lib/universe";
import {
  applyAgeBounds,
  applyListedSinceFilter,
  applyLiveVolumeFilter,
  applyLiquidityBoundFilter,
  applyMeasuredMcapFilter,
  applyNumericBounds,
  isTradeableFromLiquidity,
  isUserBound,
  mergeNewestListed,
  NEW_VOLUME_GRACE_MS,
  REQUIRE_MEASURED_MCAP_ON_NEW,
  rowPassesFeedBounds,
  showsOnNew,
  showsWithVolume24h,
} from "@/lib/priceState";
import {feedImageUrl, hexColor, isStoredImage, tokenImageCandidates} from "@/lib/tokenImage";
import {normalizeAddress, normalizeAddresses} from "@/lib/address";
import {applyThreeStateFilter, showsThreeState} from "@/lib/threeState";
import {RWA_BY_ADDRESS} from "./robinhood";
import {db, hasDatabase} from "../db";
import {storeTokenImages} from "./imageCdn";
import {mergeSocials, type SocialsSource} from "./tokenSocials";

export type {SocialsSource};

export interface TokenRow {
  address: string;
  chain_id: number;
  launchpad: LaunchpadId | null;
  symbol: string | null;
  name: string | null;
  decimals: number;
  pair_address: string | null;
  launchpad_contract?: string | null;
  pool_address?: string | null;
  fee_tier?: number | null;
  pool_quote_token?: string | null;
  pool_liquidity?: string | number | null;
  quote_token: string | null;
  quote_kind: QuoteKind | null;
  reward_rwa: string | null;
  reward_kind: string | null;
  creator: string | null;
  tax_buy: number | null;
  tax_sell: number | null;
  total_supply: number | null;
  created_at: string;
  bonded_at: string | null;
  listed_at: string | null;
  status: TokenStatus | null;
  image_url: string | null;
  image_source?: ImageSource | null;
  image_64?: string | null;
  image_128?: string | null;
  image_color?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  discord?: string | null;
  socials_source?: SocialsSource;
  socials_checked_at?: string | null;
  indexed_at: string | null;
  rewards_24h_usd: number | null;
  is_tradeable?: boolean | null;
  liquidity_usd?: number | null;
  eligible?: boolean | null;
}

export interface TokenStatRow {
  address: string;
  last_price: number | null;
  last_mcap: number | null;
  liquidity_usd: number | null;
  vol_24h: number | null;
  price_change_24h: number | null;
  updated_at: string;
  /** When we last measured a price. Null = not yet priced. */
  priced_at?: string | null;
  /** priced | no_pool | failed | null (not yet evaluated). */
  price_status?: string | null;
}

export interface TokenWrite {
  address: string;
  chain_id?: number;
  launchpad: LaunchpadId;
  symbol?: string | null;
  name?: string | null;
  decimals?: number;
  pair_address?: string | null;
  launchpad_contract?: string | null;
  pool_address?: string | null;
  fee_tier?: number | null;
  pool_quote_token?: string | null;
  pool_liquidity?: string | number | null;
  quote_token?: string | null;
  quote_kind?: QuoteKind | null;
  reward_rwa?: string | null;
  reward_kind?: string | null;
  creator?: string | null;
  tax_buy?: number | null;
  tax_sell?: number | null;
  total_supply?: number | null;
  created_at?: string;
  bonded_at?: string | null;
  listed_at?: string | null;
  status: TokenStatus;
  eligible?: boolean;
  image_url?: string | null;
  image_source?: ImageSource | null;
  image_64?: string | null;
  image_128?: string | null;
  image_color?: string | null;
}

export type ImageSource =
  | "dexscreener"
  | "pons"
  | "long"
  | "onchain"
  | "placeholder";

export const IMAGE_RANK: Record<ImageSource, number> = {
  dexscreener: 4,
  pons: 3,
  long: 3,
  onchain: 2,
  placeholder: 1,
};

function isGeneratedImage(
  url: string | null | undefined,
  source: ImageSource | null | undefined,
): boolean {
  if (source === "placeholder") return true;
  return Boolean(url?.startsWith("data:image/svg+xml"));
}

const LAUNCHPAD_META: Record<LaunchpadId, Omit<Launchpad, "url">> = {
  pons: {
    id: "pons",
    name: "Pons",
    color: "#6FA980",
    logoUrl: "/launchpads/pons.jpg",
  },
  long: {
    id: "long",
    name: "Long",
    color: "#79FF77",
    logoUrl: "/launchpads/long.svg",
  },
};

function launchpadFor(id: LaunchpadId | null, address: string): Launchpad | null {
  if (!id) return null;
  const meta = LAUNCHPAD_META[id];
  if (!meta) return null;
  const url =
    id === "pons"
      ? `https://www.ponsfamily.com/launchpad/${address}`
      : `https://app.long.xyz/tokens/${address}`;
  return {...meta, url};
}

export async function getTokenRow(address: string): Promise<TokenRow | null> {
  if (!hasDatabase) return null;
  const {data, error} = await db()
    .from("tokens")
    .select("*")
    .eq("address", normalizeAddress(address))
    .maybeSingle();
  if (error) throw error;
  return (data as TokenRow | null) ?? null;
}

export async function getTokenRows(addresses: string[]): Promise<TokenRow[]> {
  if (!hasDatabase || addresses.length === 0) return [];
  const {data, error} = await db()
    .from("tokens")
    .select("*")
    .in("address", normalizeAddresses(addresses));
  if (error) throw error;
  return (data as TokenRow[]) ?? [];
}

export async function getTokenBySymbol(symbol: string): Promise<TokenRow | null> {
  if (!hasDatabase) return null;
  const {data, error} = await db()
    .from("tokens")
    .select("*")
    .ilike("symbol", symbol)
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .order("listed_at", {ascending: false})
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TokenRow | null) ?? null;
}

export function writeQualifies(
  row: Pick<TokenWrite, "launchpad" | "quote_kind" | "reward_rwa" | "bonded_at">,
): boolean {
  return qualifiesForUniverse({
    launchpad: row.launchpad,
    quoteKind: row.quote_kind ?? null,
    rewardRwa: row.reward_rwa ?? null,
    bonded: Boolean(row.bonded_at) || row.launchpad === "long",
  });
}

/**
 * Universe membership is three-state: hide only an evaluated false.
 * Null (not yet evaluated) still shows.
 */
function applyUniverseFilter<T>(request: T): T {
  return applyThreeStateFilter(request, "eligible");
}

/** Home Rewards and New `?rewards=rwa` — indexed 24h USD, not a routing flag. */
function applyRewardsAmountFilter<T>(request: T): T {
  return (request as {gt: (column: string, value: number) => T}).gt(
    "rewards_24h_usd",
    0,
  );
}

function applyLegacyUniverseFilter<T>(request: T): T {
  return (request as {or: (filter: string) => T}).or(
    "quote_kind.eq.rwa,reward_rwa.not.is.null",
  );
}

function rowPassesUniverse(row: TokenRow): boolean {
  return showsThreeState(row.eligible);
}

/**
 * Hide only tokens we have measured as below the floor.
 * Unmeasured (null) stays in the feed so New is not emptied.
 * An explicit user min/max uses `.gte` / `.lte` so null cannot pass.
 */
function applyTradeableFilter<T>(
  request: T,
  minLiquidity?: number | null,
  maxLiquidity?: number | null,
): T {
  return applyLiquidityBoundFilter(request, minLiquidity, maxLiquidity);
}

const TOKEN_STATS_INNER =
  "*, token_stats!inner(last_mcap, liquidity_usd, last_price, priced_at, price_status, vol_24h, price_change_24h, updated_at)";

function flattenTokenRow(row: TokenRow): TokenRow {
  if (row && typeof row === "object" && "token_stats" in row) {
    const {token_stats: _embed, ...rest} = row as TokenRow & {token_stats?: unknown};
    return rest as TokenRow;
  }
  return row;
}

function finiteOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function listStoredTokens(): Promise<TokenRow[]> {
  if (!hasDatabase) return [];
  let request = db()
    .from("tokens")
    .select("*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .order("listed_at", {ascending: false})
    .limit(500);
  request = applyUniverseFilter(request);
  const {data, error} = await request;
  if (error) throw error;
  return (data as TokenRow[]) ?? [];
}

export type FeedSort = "new" | "volume" | "mcap" | "rewards";

/** Stats-ordered pages require a real pool so fake-liq clones cannot dominate. */
export function hasRealPool(row: {
  pair_address?: string | null;
  pool_address?: string | null;
}): boolean {
  return Boolean(row.pair_address?.trim() || row.pool_address?.trim());
}

export interface TokenPageQuery {
  cursorListedAt?: string | null;
  cursorAddress?: string | null;
  limit?: number;
  launchpad?: LaunchpadId | null;
  quoteKind?: QuoteKind | null;
  rewardsOnly?: boolean;
  minLiquidity?: number | null;
  maxLiquidity?: number | null;
  minMarketCap?: number | null;
  maxMarketCap?: number | null;
  /** 24h USD volume (`vol_24h`). Window is display/sort only. */
  minVolume?: number | null;
  maxVolume?: number | null;
  minAgeHours?: number | null;
  maxAgeHours?: number | null;
  sort?: FeedSort;
}

function newListStatsBound(query: TokenPageQuery): boolean {
  return (
    isUserBound(query.minMarketCap, query.maxMarketCap) ||
    isUserBound(query.minVolume, query.maxVolume) ||
    REQUIRE_MEASURED_MCAP_ON_NEW
  );
}

/**
 * New feed base query. Volume (`vol_24h > 0`) and the 6h launch window are
 * applied by the caller as two requests — a single PostgREST `.or()` cannot
 * mix `token_stats.vol_24h` with `listed_at`.
 */
function newListBaseQuery(
  query: TokenPageQuery,
  limit: number,
  universe: "three-state" | "legacy",
): any {
  const statsBound = newListStatsBound(query);
  const liqBound = isUserBound(query.minLiquidity, query.maxLiquidity);
  let request: any = db()
    .from("tokens")
    .select(statsBound ? TOKEN_STATS_INNER : "*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .not("listed_at", "is", null)
    .order("listed_at", {ascending: false})
    .order("address", {ascending: false})
    .limit(limit + 1);
  request =
    universe === "legacy"
      ? applyLegacyUniverseFilter(request)
      : applyUniverseFilter(request);
  if (REQUIRE_MEASURED_MCAP_ON_NEW) {
    request = applyMeasuredMcapFilter(request, "token_stats");
  }
  if (statsBound) {
    request = applyNumericBounds(
      request,
      "token_stats.last_mcap",
      query.minMarketCap,
      query.maxMarketCap,
    );
    request = applyNumericBounds(
      request,
      "token_stats.vol_24h",
      query.minVolume,
      query.maxVolume,
    );
    if (liqBound) {
      request = applyNumericBounds(
        request,
        "token_stats.liquidity_usd",
        query.minLiquidity,
        query.maxLiquidity,
      );
    } else {
      request = applyThreeStateFilter(request, "is_tradeable");
    }
  } else {
    request = applyTradeableFilter(request, query.minLiquidity, query.maxLiquidity);
  }
  request = applyAgeBounds(request, query.minAgeHours, query.maxAgeHours);
  if (query.cursorListedAt) request = request.lt("listed_at", query.cursorListedAt);
  if (query.launchpad) request = request.eq("launchpad", query.launchpad);
  if (query.quoteKind) request = request.eq("quote_kind", query.quoteKind);
  if (query.rewardsOnly) request = applyRewardsAmountFilter(request);
  return request;
}

async function fetchNewListRows(
  query: TokenPageQuery,
  limit: number,
  universe: "three-state" | "legacy",
): Promise<{rows: TokenRow[]; error: {message: string} | null}> {
  const statsBound = newListStatsBound(query);
  const graceSince = new Date(Date.now() - NEW_VOLUME_GRACE_MS).toISOString();
  const volumeReq = applyLiveVolumeFilter(newListBaseQuery(query, limit, universe), {
    columnPrefix: statsBound ? "token_stats" : undefined,
  });
  const graceReq = applyListedSinceFilter(
    newListBaseQuery(query, limit, universe),
    graceSince,
  );
  const [volume, grace] = await Promise.all([volumeReq, graceReq]);
  if (volume.error && grace.error) {
    return {rows: [], error: volume.error};
  }
  if (volume.error) {
    console.error("new feed volume filter failed; serving 6h listings", volume.error);
  }
  if (grace.error) {
    console.error("new feed grace window failed; serving live-volume rows", grace.error);
  }
  const rows = mergeNewestListed(
    [...((volume.data as TokenRow[]) ?? []), ...((grace.data as TokenRow[]) ?? [])].map(
      flattenTokenRow,
    ),
  );
  return {rows, error: null};
}

export async function listTokensPage(
  query: TokenPageQuery,
): Promise<{rows: TokenRow[]; stats: Map<string, TokenStatRow>; next: string | null}> {
  if (!hasDatabase) return {rows: [], stats: new Map(), next: null};
  const sort = query.sort ?? "new";
  if (sort === "volume" || sort === "mcap") {
    return listStatsOrderedPage(query, sort === "mcap" ? "last_mcap" : "vol_24h");
  }
  if (sort === "rewards") {
    return listRewardsOrderedPage(query);
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  let {rows: fetched, error} = await fetchNewListRows(query, limit, "three-state");
  if (error && /eligible/i.test(error.message)) {
    console.error("tokens.eligible filter failed; falling back to quote_kind");
    ({rows: fetched, error} = await fetchNewListRows(query, limit, "legacy"));
  }
  if (error && /is_tradeable|liquidity_usd/i.test(error.message)) {
    console.error("tokens tradeable columns missing — run scripts/schema-tradeable.sql");
  }
  if (error) throw error;
  const page = fetched.slice(0, limit);
  const stats = await statsFor(page.map((row) => row.address));

  const filtered = page.filter((row) => {
    const stat = stats.get(normalizeAddress(row.address));
    const liq = finiteOrNull(stat?.liquidity_usd ?? row.liquidity_usd);
    const mcap = finiteOrNull(stat?.last_mcap);
    if (
      !rowPassesFeedBounds({
        mcap,
        liq,
        tradeable: row.is_tradeable,
        volume: finiteOrNull(stat?.vol_24h),
        createdAt: row.created_at,
        minMarketCap: query.minMarketCap,
        maxMarketCap: query.maxMarketCap,
        minLiquidity: query.minLiquidity,
        maxLiquidity: query.maxLiquidity,
        minVolume: query.minVolume,
        maxVolume: query.maxVolume,
        minAgeHours: query.minAgeHours,
        maxAgeHours: query.maxAgeHours,
      })
    ) {
      return false;
    }
    if (!showsOnNew(stat)) return false;
    if (
      !showsWithVolume24h(finiteOrNull(stat?.vol_24h), {
        listedAt: row.listed_at,
        allowNewGrace: true,
      })
    ) {
      return false;
    }
    return rowPassesUniverse(row);
  });

  const last = fetched.length > limit ? page[page.length - 1] : null;
  const next =
    last?.listed_at && last.address
      ? `${last.listed_at}|${last.address}`
      : null;

  return {rows: filtered, stats, next};
}

/** Home Rewards: listed tokens with a persisted 24h payout, largest first. */
async function listRewardsOrderedPage(
  query: TokenPageQuery,
): Promise<{rows: TokenRow[]; stats: Map<string, TokenStatRow>; next: string | null}> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const statsBound =
    isUserBound(query.minMarketCap, query.maxMarketCap) ||
    isUserBound(query.minVolume, query.maxVolume) ||
    REQUIRE_MEASURED_MCAP_ON_NEW;
  const liqBound = isUserBound(query.minLiquidity, query.maxLiquidity);

  let request: any = db()
    .from("tokens")
    .select(statsBound ? TOKEN_STATS_INNER : "*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .order("rewards_24h_usd", {ascending: false, nullsFirst: false})
    .order("address", {ascending: false})
    .limit(limit + 1);
  request = applyUniverseFilter(request);
  request = applyRewardsAmountFilter(request);
  if (REQUIRE_MEASURED_MCAP_ON_NEW) {
    request = applyMeasuredMcapFilter(request, "token_stats");
  }
  if (statsBound) {
    request = applyNumericBounds(
      request,
      "token_stats.last_mcap",
      query.minMarketCap,
      query.maxMarketCap,
    );
    request = applyNumericBounds(
      request,
      "token_stats.vol_24h",
      query.minVolume,
      query.maxVolume,
    );
    if (liqBound) {
      request = applyNumericBounds(
        request,
        "token_stats.liquidity_usd",
        query.minLiquidity,
        query.maxLiquidity,
      );
    } else {
      request = applyThreeStateFilter(request, "is_tradeable");
    }
  } else {
    request = applyTradeableFilter(request, query.minLiquidity, query.maxLiquidity);
  }
  request = applyAgeBounds(request, query.minAgeHours, query.maxAgeHours);
  request = applyLiveVolumeFilter(request, {
    columnPrefix: statsBound ? "token_stats" : undefined,
  });
  if (query.launchpad) request = request.eq("launchpad", query.launchpad);
  if (query.quoteKind) request = request.eq("quote_kind", query.quoteKind);

  const {data, error} = await request;
  if (error) throw error;
  const fetched = ((data as TokenRow[]) ?? []).map(flattenTokenRow);
  const page = fetched.slice(0, limit);
  const stats = await statsFor(page.map((row) => row.address));
  const filtered = page.filter((row) => {
    const stat = stats.get(normalizeAddress(row.address));
    if (
      !rowPassesFeedBounds({
        mcap: finiteOrNull(stat?.last_mcap),
        liq: finiteOrNull(stat?.liquidity_usd ?? row.liquidity_usd),
        tradeable: row.is_tradeable,
        volume: finiteOrNull(stat?.vol_24h),
        createdAt: row.created_at,
        minMarketCap: query.minMarketCap,
        maxMarketCap: query.maxMarketCap,
        minLiquidity: query.minLiquidity,
        maxLiquidity: query.maxLiquidity,
        minVolume: query.minVolume,
        maxVolume: query.maxVolume,
        minAgeHours: query.minAgeHours,
        maxAgeHours: query.maxAgeHours,
      })
    ) {
      return false;
    }
    if (!showsOnNew(stat)) return false;
    if (!showsWithVolume24h(finiteOrNull(stat?.vol_24h))) return false;
    return rowPassesUniverse(row);
  });

  return {rows: filtered, stats, next: null};
}

async function listStatsOrderedPage(
  query: TokenPageQuery,
  column: "vol_24h" | "last_mcap",
): Promise<{rows: TokenRow[]; stats: Map<string, TokenStatRow>; next: string | null}> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const fetchN = Math.min(limit * 4, 200);
  let statsQuery: any = db()
    .from("token_stats")
    .select("*")
    .order(column, {ascending: false, nullsFirst: false})
    .limit(fetchN);
  statsQuery = applyNumericBounds(
    statsQuery,
    "last_mcap",
    query.minMarketCap,
    query.maxMarketCap,
  );
  statsQuery = applyNumericBounds(
    statsQuery,
    "liquidity_usd",
    query.minLiquidity,
    query.maxLiquidity,
  );
  statsQuery = applyNumericBounds(
    statsQuery,
    "vol_24h",
    query.minVolume,
    query.maxVolume,
  );
  statsQuery = applyLiveVolumeFilter(statsQuery);
  const {data: hot, error: statsError} = await statsQuery;
  if (statsError) throw statsError;
  const statRows = (hot ?? []) as TokenStatRow[];
  if (statRows.length === 0) return {rows: [], stats: new Map(), next: null};

  let tokensQuery: any = db()
    .from("tokens")
    .select("*")
    .in("address", normalizeAddresses(statRows.map((row) => row.address)))
    .eq("status", "listed")
    .not("launchpad", "is", null);
  tokensQuery = applyUniverseFilter(tokensQuery);
  tokensQuery = applyThreeStateFilter(tokensQuery, "is_tradeable");
  tokensQuery = applyAgeBounds(tokensQuery, query.minAgeHours, query.maxAgeHours);
  if (query.launchpad) tokensQuery = tokensQuery.eq("launchpad", query.launchpad);
  if (query.quoteKind) tokensQuery = tokensQuery.eq("quote_kind", query.quoteKind);
  if (query.rewardsOnly) tokensQuery = applyRewardsAmountFilter(tokensQuery);

  let {data, error} = await tokensQuery;
  if (error && /is_tradeable|liquidity_usd/i.test(error.message)) {
    console.error("tokens tradeable columns missing — run scripts/schema-tradeable.sql");
    tokensQuery = applyUniverseFilter(
      db()
        .from("tokens")
        .select("*")
        .in("address", normalizeAddresses(statRows.map((row) => row.address)))
        .eq("status", "listed")
        .not("launchpad", "is", null),
    );
    tokensQuery = applyAgeBounds(tokensQuery, query.minAgeHours, query.maxAgeHours);
    if (query.launchpad) tokensQuery = tokensQuery.eq("launchpad", query.launchpad);
    if (query.quoteKind) tokensQuery = tokensQuery.eq("quote_kind", query.quoteKind);
    if (query.rewardsOnly) tokensQuery = applyRewardsAmountFilter(tokensQuery);
    const retry = await tokensQuery;
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  const byAddress = new Map(
    ((data as TokenRow[]) ?? []).map((row) => [normalizeAddress(row.address), row]),
  );
  const stats = new Map(
    statRows.map((row) => [normalizeAddress(row.address), row]),
  );
  const ordered = statRows
    .map((row) => byAddress.get(normalizeAddress(row.address)))
    .filter((row): row is TokenRow => Boolean(row))
    .filter((row) => hasRealPool(row))
    .filter((row) => rowPassesUniverse(row))
    .filter((row) => {
      const stat = stats.get(normalizeAddress(row.address));
      const liq = finiteOrNull(stat?.liquidity_usd ?? row.liquidity_usd);
      const mcap = finiteOrNull(stat?.last_mcap);
      if (
        !rowPassesFeedBounds({
          mcap,
          liq,
          tradeable: row.is_tradeable,
          volume: finiteOrNull(stat?.vol_24h),
          createdAt: row.created_at,
          minMarketCap: query.minMarketCap,
          maxMarketCap: query.maxMarketCap,
          minLiquidity: query.minLiquidity,
          maxLiquidity: query.maxLiquidity,
          minVolume: query.minVolume,
          maxVolume: query.maxVolume,
          minAgeHours: query.minAgeHours,
          maxAgeHours: query.maxAgeHours,
        })
      ) {
        return false;
      }
      if (!showsOnNew(stat)) return false;
      if (!showsWithVolume24h(finiteOrNull(stat?.vol_24h))) return false;
      return true;
    })
    .slice(0, limit);

  return {rows: ordered, stats, next: null};
}

export const RECENT_MISSING_IMAGE_LIMIT = 16;
export const RECENT_MISSING_IMAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function recentMissingImageWindow(now = Date.now()): {
  listedSince: string;
  limit: number;
} {
  return {
    listedSince: new Date(now - RECENT_MISSING_IMAGE_MAX_AGE_MS).toISOString(),
    limit: RECENT_MISSING_IMAGE_LIMIT,
  };
}

/**
 * Newest listed rows still missing artwork. Worker catch-up only — small
 * keyset, not a backfill. Universe membership is three-state.
 */
export async function listRecentMissingImages(
  limit = RECENT_MISSING_IMAGE_LIMIT,
  now = Date.now(),
): Promise<{address: string; launchpad: LaunchpadId | null}[]> {
  if (!hasDatabase) return [];
  const {listedSince} = recentMissingImageWindow(now);
  let request: any = db()
    .from("tokens")
    .select("address, launchpad")
    .eq("status", "listed")
    .is("image_url", null)
    .not("listed_at", "is", null)
    .gte("listed_at", listedSince)
    .order("listed_at", {ascending: false})
    .limit(limit);
  request = applyUniverseFilter(request);
  const {data, error} = await request;
  if (error) {
    console.error("recent missing images read failed", error);
    return [];
  }
  return ((data ?? []) as {address: string; launchpad: LaunchpadId | null}[]).map((row) => ({
    address: normalizeAddress(String(row.address)),
    launchpad: row.launchpad === "pons" || row.launchpad === "long" ? row.launchpad : null,
  }));
}

/** Addresses the stats cron should keep warm: last 7 days + top volume. */
export async function addressesForStatsWarm(opts?: {
  recentLimit?: number;
  topLimit?: number;
}): Promise<string[]> {
  if (!hasDatabase) return [];
  const recentLimit = opts?.recentLimit ?? 400;
  const topLimit = opts?.topLimit ?? 400;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();

  let recentQuery: any = db()
    .from("tokens")
    .select("address")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .gte("listed_at", since)
    .order("listed_at", {ascending: false})
    .limit(recentLimit);
  recentQuery = applyUniverseFilter(recentQuery);

  const [recent, top] = await Promise.all([
    recentQuery,
    db()
      .from("token_stats")
      .select("address")
      .order("vol_24h", {ascending: false, nullsFirst: false})
      .limit(topLimit),
  ]);
  if (recent.error) throw recent.error;
  if (top.error && !/token_stats/i.test(top.error.message)) throw top.error;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of [...(recent.data ?? []), ...(top.data ?? [])]) {
    const address = row.address ? normalizeAddress(String(row.address)) : "";
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

export async function searchTokenRows(query: string, limit = 40): Promise<TokenRow[]> {
  if (!hasDatabase) return [];
  const q = query.trim();
  if (!q) return [];

  let request: any = applyUniverseFilter(
    db()
      .from("tokens")
      .select("*")
      .eq("status", "listed")
      .not("launchpad", "is", null)
      .or(`symbol.ilike.${q}%,name.ilike.%${q}%,address.eq.${normalizeAddress(q)}`)
      .order("listed_at", {ascending: false})
      .limit(limit),
  );
  const {data, error} = await request;
  if (error) throw error;
  return ((data as TokenRow[]) ?? []).filter((row) => rowPassesUniverse(row));
}

export async function statsFor(
  addresses: string[],
): Promise<Map<string, TokenStatRow>> {
  const out = new Map<string, TokenStatRow>();
  if (!hasDatabase || addresses.length === 0) return out;

  for (let i = 0; i < addresses.length; i += 200) {
    const slice = normalizeAddresses(addresses.slice(i, i + 200));
    const {data, error} = await db()
      .from("token_stats")
      .select("*")
      .in("address", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      out.set(normalizeAddress(String(row.address)), row as TokenStatRow);
    }
  }
  return out;
}

/**
 * Idempotent upsert. Stats are never written here — a price refresh cannot
 * remove or rewrite membership.
 */
export async function upsertTokens(rows: TokenWrite[]): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;
  const now = new Date().toISOString();
  const accepted = rows.filter((row) => writeQualifies(row));
  if (accepted.length === 0) return 0;
  const payload = accepted.map((row) => {
    const {
      image_url: _image,
      image_source: _source,
      image_64: _64,
      image_128: _128,
      image_color: _color,
      ...rest
    } = row;
    return {
      ...rest,
      address: normalizeAddress(row.address),
      chain_id: row.chain_id ?? 4663,
      indexed_at: now,
      eligible: row.eligible ?? true,
    };
  });

  const {error} = await db()
    .from("tokens")
    .upsert(payload, {onConflict: "address"});
  if (error && /eligible/i.test(error.message)) {
    console.error("tokens.eligible missing — run scripts/schema-eligible.sql");
    const stripped = payload.map((row) => {
      const {eligible: _e, ...rest} = row as typeof payload[number] & {eligible?: boolean};
      return rest;
    });
    const retry = await db().from("tokens").upsert(stripped, {onConflict: "address"});
    if (retry.error && !/pool_address|fee_tier|pool_quote_token|pool_liquidity|launchpad_contract/i.test(retry.error.message)) {
      throw retry.error;
    }
    if (!retry.error) return stripped.length;
  }
  if (error && /pool_address|fee_tier|pool_quote_token|pool_liquidity|launchpad_contract/i.test(error.message)) {
    console.error("tokens pool columns missing — run scripts/schema-pools.sql", error.message);
    const stripped = payload.map((row) => {
      const {
        pool_address: _p,
        fee_tier: _f,
        pool_quote_token: _q,
        pool_liquidity: _l,
        launchpad_contract: _c,
        ...rest
      } = row as TokenWrite & {address: string; chain_id: number; indexed_at: string};
      return rest;
    });
    const retry = await db().from("tokens").upsert(stripped, {onConflict: "address"});
    if (retry.error) throw retry.error;
    return stripped.length;
  }
  if (error) throw error;
  return payload.length;
}

export async function replaceTokenPools(
  rows: {token: string; pool: string; fee: number; quote: string; liquidity: bigint}[],
): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;
  const now = new Date().toISOString();
  const tokens = [...new Set(rows.map((row) => normalizeAddress(row.token)))];
  const del = await db().from("token_pools").delete().in("token", tokens);
  if (del.error) {
    if (/token_pools/i.test(del.error.message)) {
      console.error("token_pools missing — run scripts/schema-pools.sql", del.error.message);
      return 0;
    }
    throw del.error;
  }
  const {error} = await db().from("token_pools").insert(
    rows.map((row) => ({
      token: normalizeAddress(row.token),
      pool_address: normalizeAddress(row.pool),
      fee_tier: row.fee,
      quote_token: normalizeAddress(row.quote),
      liquidity: row.liquidity.toString(),
      updated_at: now,
    })),
  );
  if (error) throw error;
  return rows.length;
}

let pricedColumnsWarned = false;

export async function upsertStats(
  rows: Omit<TokenStatRow, "updated_at">[],
): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;
  const now = new Date().toISOString();
  const finite = (value: number | null | undefined): number | null =>
    value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  const payload = rows.map((row) => ({
    ...row,
    address: normalizeAddress(row.address),
    last_price: finite(row.last_price),
    last_mcap: finite(row.last_mcap),
    liquidity_usd: finite(row.liquidity_usd),
    vol_24h: finite(row.vol_24h),
    price_change_24h: finite(row.price_change_24h),
    updated_at: now,
  }));

  for (let i = 0; i < payload.length; i += 80) {
    const slice = payload.slice(i, i + 80);
    const {error} = await db()
      .from("token_stats")
      .upsert(slice, {onConflict: "address"});
    if (error && /priced_at|price_status/i.test(error.message)) {
      if (!pricedColumnsWarned) {
        pricedColumnsWarned = true;
        console.error("token_stats priced columns missing — run scripts/schema-priced.sql");
      }
      const stripped = slice.map((row) => {
        const {priced_at: _p, price_status: _s, ...rest} = row as typeof slice[number] & {
          priced_at?: string | null;
          price_status?: string | null;
        };
        return rest;
      });
      const retry = await db().from("token_stats").upsert(stripped, {onConflict: "address"});
      if (retry.error) {
        console.error("token_stats upsert retry failed", retry.error.message, retry.error);
        throw retry.error;
      }
    } else if (error) {
      console.error("token_stats upsert failed", error.message, error);
      throw error;
    }
  }
  await refreshTradeableFlags(
    rows.map((row) => ({
      address: row.address,
      liquidity_usd: row.liquidity_usd ?? null,
    })),
  );
  return rows.length;
}

/**
 * Display flag only. Never deletes a row. Null stays null when liquidity
 * has not been measured yet.
 */
export async function refreshTradeableFlags(
  rows: {address: string; liquidity_usd: number | null}[],
): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;
  let wrote = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const slice = rows.slice(i, i + 25);
    const results = await Promise.all(
      slice.map((row) => {
        const address = normalizeAddress(row.address);
        const liq =
          row.liquidity_usd != null && Number.isFinite(Number(row.liquidity_usd))
            ? Number(row.liquidity_usd)
            : null;
        return db()
          .from("tokens")
          .update(
            {
              liquidity_usd: liq,
              is_tradeable: isTradeableFromLiquidity(liq),
            },
            {count: "exact"},
          )
          .eq("address", address);
      }),
    );
    for (const {error, count} of results) {
      if (error) {
        if (/is_tradeable|liquidity_usd/i.test(error.message)) {
          console.error("tokens tradeable columns missing — run scripts/schema-tradeable.sql");
          return wrote;
        }
        console.error("tradeable flag write failed", error);
        continue;
      }
      wrote += count ?? 0;
    }
  }
  return wrote;
}

/** Drop invented SVGs so a later pass can write the real artwork. */
export async function clearGeneratedPlaceholders(): Promise<number> {
  if (!hasDatabase) return 0;
  let cleared = 0;
  const empty = {image_url: null, image_source: null};
  const bySource = await db()
    .from("tokens")
    .update(empty, {count: "exact"})
    .eq("image_source", "placeholder");
  if (bySource.error) {
    console.error("placeholder clear failed", bySource.error);
  } else {
    cleared += bySource.count ?? 0;
  }
  const byUrl = await db()
    .from("tokens")
    .update(empty, {count: "exact"})
    .like("image_url", "data:image/svg+xml%");
  if (byUrl.error) {
    console.error("generated image clear failed", byUrl.error);
  } else {
    cleared += byUrl.count ?? 0;
  }
  return cleared;
}

/** Write logos the indexer never saw. Only fills a null — never overwrites. */
export async function writeMissingImages(
  rows: {address: string; image_url: string; image_source?: ImageSource}[],
): Promise<number> {
  return writeTokenImages(
    rows.map((row) => ({
      address: row.address,
      image_url: row.image_url,
      image_source: row.image_source ?? "dexscreener",
    })),
    {resize: false},
  );
}

/**
 * Persist a resolved PFP. Higher-ranked sources win; a DexScreener hit can
 * replace a launchpad fallback, never the other way around.
 *
 * The remote URL is written first. Resize into Storage is optional — Sharp
 * failures used to drop the URL entirely, which is why thousands of rows
 * had no picture even though every launch has one on-chain.
 */
export async function writeTokenImages(
  rows: {address: string; image_url: string; image_source: ImageSource}[],
  opts?: {resize?: boolean},
): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;
  const resize = opts?.resize !== false;

  const wanted = rows.map((row) => ({
    address: normalizeAddress(row.address),
    image_url: row.image_url,
    image_source: row.image_source,
  }));

  const held = new Map<
    string,
    {source: ImageSource | null; hasUrl: boolean; hasVariants: boolean}
  >();
  let variantsReady = true;
  for (let i = 0; i < wanted.length; i += 200) {
    const slice = wanted.slice(i, i + 200).map((row) => row.address);
    const first = await db()
      .from("tokens")
      .select("address, image_url, image_source, image_64")
      .in("address", slice);
    let existing: {address: string; image_url: string | null; image_source: string | null; image_64?: string | null}[] =
      [];
    if (first.error && /image_64/i.test(first.error.message)) {
      variantsReady = false;
      console.error(
        "tokens.image_64 missing — run scripts/schema-image-cdn.sql",
        first.error.message,
      );
      const retry = await db()
        .from("tokens")
        .select("address, image_url, image_source")
        .in("address", slice);
      if (retry.error) {
        console.error("image source read failed", retry.error);
        break;
      }
      existing = (retry.data ?? []) as typeof existing;
    } else if (first.error) {
      if (/image_source/i.test(first.error.message)) {
        console.error(
          "tokens.image_source is missing — run scripts/schema-images.sql",
          first.error.message,
        );
      } else {
        console.error("image source read failed", first.error);
      }
      break;
    } else {
      existing = (first.data ?? []) as typeof existing;
    }
    for (const row of existing) {
      const source = (row.image_source as ImageSource | null) ?? null;
      const url = typeof row.image_url === "string" ? row.image_url : null;
      held.set(normalizeAddress(String(row.address)), {
        source,
        hasUrl: Boolean(url) && !isGeneratedImage(url, source),
        hasVariants: Boolean(row.image_64),
      });
    }
  }

  const writes = wanted.filter((row) => {
    if (isGeneratedImage(row.image_url, row.image_source)) return false;
    const current = held.get(row.address);
    if (!current?.hasUrl) return true;
    if (resize && variantsReady && !current.hasVariants) return true;
    if (row.image_source === "placeholder") return false;
    if (!current.source) return true;
    return IMAGE_RANK[row.image_source] > IMAGE_RANK[current.source];
  });
  if (writes.length === 0) return 0;

  let wrote = 0;
  for (let i = 0; i < writes.length; i += 25) {
    const slice = writes.slice(i, i + 25);
    const results = await Promise.all(
      slice.map((row) =>
        db()
          .from("tokens")
          .update(
            {image_url: row.image_url, image_source: row.image_source},
            {count: "exact"},
          )
          .eq("address", row.address),
      ),
    );
    for (const {error, count} of results) {
      if (error) {
        console.error("image write failed", error);
        continue;
      }
      wrote += count ?? 0;
    }
  }

  if (resize && variantsReady) {
    const stored = await storeTokenImages(
      writes.map((row) => ({address: row.address, url: row.image_url})),
    );
    for (const [address, variants] of stored) {
      const {error} = await db()
        .from("tokens")
        .update({
          image_64: variants.image_64,
          image_128: variants.image_128,
          image_color: variants.image_color,
        })
        .eq("address", address);
      if (error) {
        console.error("image variant write failed", error);
      }
    }
  }

  return wrote;
}

export type TokenSocialsWrite = {
  address: string;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  discord: string | null;
  socials_source: SocialsSource;
};

/**
 * Persist resolved socials. Per-field merge with whatever is already stored
 * so a Dex miss cannot blank a launchpad link. Always stamps
 * `socials_checked_at` so refresh can skip a recent attempt.
 */
export async function writeTokenSocials(rows: TokenSocialsWrite[]): Promise<number> {
  if (!hasDatabase || rows.length === 0) return 0;

  const wanted = rows.map((row) => ({
    ...row,
    address: normalizeAddress(row.address),
  }));

  const held = new Map<
    string,
    {
      twitter: string | null;
      telegram: string | null;
      website: string | null;
      discord: string | null;
      socials_source: SocialsSource;
    }
  >();
  for (let i = 0; i < wanted.length; i += 200) {
    const slice = wanted.slice(i, i + 200).map((row) => row.address);
    const {data, error} = await db()
      .from("tokens")
      .select("address, twitter, telegram, website, discord, socials_source")
      .in("address", slice);
    if (error) {
      if (/twitter|telegram|website|discord|socials_source|schema cache/i.test(error.message)) {
        console.error(
          "tokens socials columns missing — paste scripts/schema-socials.sql",
          error.message,
        );
        return 0;
      }
      console.error("socials read failed", error);
      break;
    }
    for (const row of (data ?? []) as {
      address: string;
      twitter?: string | null;
      telegram?: string | null;
      website?: string | null;
      discord?: string | null;
      socials_source?: string | null;
    }[]) {
      held.set(normalizeAddress(String(row.address)), {
        twitter: row.twitter ?? null,
        telegram: row.telegram ?? null,
        website: row.website ?? null,
        discord: row.discord ?? null,
        socials_source: (row.socials_source as SocialsSource) ?? null,
      });
    }
  }

  const now = new Date().toISOString();
  let wrote = 0;
  for (let i = 0; i < wanted.length; i += 25) {
    const slice = wanted.slice(i, i + 25);
    const results = await Promise.all(
      slice.map((row) => {
        const current = held.get(row.address);
        const merged = mergeSocials(
          {
            x: row.twitter,
            telegram: row.telegram,
            website: row.website,
            discord: row.discord,
          },
          {
            x: current?.twitter ?? null,
            telegram: current?.telegram ?? null,
            website: current?.website ?? null,
            discord: current?.discord ?? null,
          },
        );
        const source =
          row.socials_source === "pons" || row.socials_source === "long"
            ? row.socials_source
            : current?.socials_source === "pons" || current?.socials_source === "long"
              ? current.socials_source
              : (row.socials_source ?? current?.socials_source ?? null);
        return db()
          .from("tokens")
          .update(
            {
              twitter: merged.x,
              telegram: merged.telegram,
              website: merged.website,
              discord: merged.discord,
              socials_source: source,
              socials_checked_at: now,
            },
            {count: "exact"},
          )
          .eq("address", row.address);
      }),
    );
    for (const {error, count} of results) {
      if (error) {
        if (/twitter|telegram|website|discord|socials_|schema cache/i.test(error.message)) {
          console.error(
            "tokens socials columns missing — paste scripts/schema-socials.sql",
            error.message,
          );
          return wrote;
        }
        console.error("socials write failed", error);
        continue;
      }
      wrote += count ?? 0;
    }
  }
  return wrote;
}

export interface PricingCoverage {
  listedEligible: number;
  measured: number;
  ratio: number;
  noPool: number;
  failed: number;
}

/**
 * Listed eligible vs measured mcap (priced_at AND last_mcap > 0).
 * Null last_mcap is not counted as priced or as zero.
 */
export async function pricingCoverage(): Promise<PricingCoverage> {
  const empty = {listedEligible: 0, measured: 0, ratio: 0, noPool: 0, failed: 0};
  if (!hasDatabase) return empty;

  let listedQuery: any = db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed")
    .not("launchpad", "is", null);
  listedQuery = applyUniverseFilter(listedQuery);

  const [listed, measured, noPool, failed] = await Promise.all([
    listedQuery,
    db()
      .from("token_stats")
      .select("address", {count: "exact", head: true})
      .not("priced_at", "is", null)
      .gt("last_mcap", 0),
    db()
      .from("token_stats")
      .select("address", {count: "exact", head: true})
      .eq("price_status", "no_pool"),
    db()
      .from("token_stats")
      .select("address", {count: "exact", head: true})
      .eq("price_status", "failed"),
  ]);

  if (listed.error) {
    console.error("pricing coverage listed count failed", listed.error.message);
    return empty;
  }
  const listedEligible = listed.count ?? 0;
  const measuredCount =
    measured.error ? 0 : (measured.count ?? 0);
  const noPoolCount = noPool.error ? 0 : (noPool.count ?? 0);
  const failedCount = failed.error ? 0 : (failed.count ?? 0);

  return {
    listedEligible,
    measured: measuredCount,
    ratio: listedEligible > 0 ? measuredCount / listedEligible : 0,
    noPool: noPoolCount,
    failed: failedCount,
  };
}

export async function imageCoverage(): Promise<{
  listedEligible: number;
  withImage: number;
  missing: number;
}> {
  const empty = {listedEligible: 0, withImage: 0, missing: 0};
  if (!hasDatabase) return empty;

  const listed = db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed")
    .or("quote_kind.eq.rwa,reward_rwa.not.is.null");
  const imaged = db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed")
    .or("quote_kind.eq.rwa,reward_rwa.not.is.null")
    .not("image_url", "is", null);

  const [listedRes, imagedRes] = await Promise.all([listed, imaged]);
  if (listedRes.error) {
    console.error(
      "image coverage listed count failed",
      listedRes.error.message ?? listedRes.error,
    );
    return empty;
  }
  const listedEligible = listedRes.count ?? 0;
  const withImage = imagedRes.error ? 0 : (imagedRes.count ?? 0);
  return {
    listedEligible,
    withImage,
    missing: Math.max(0, listedEligible - withImage),
  };
}

export async function listNewestListed(limit: number): Promise<TokenRow[]> {
  if (!hasDatabase) return [];
  let request: any = db()
    .from("tokens")
    .select("*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .not("listed_at", "is", null)
    .order("listed_at", {ascending: false})
    .limit(limit);
  request = applyUniverseFilter(request);
  const {data, error} = await request;
  if (error) throw error;
  return (data as TokenRow[]) ?? [];
}

/** Slim columns for the minute price cron. Never star or image blobs. */
export const PRICE_LIST_COLUMNS =
  "address,launchpad,decimals,total_supply,quote_token,quote_kind,status,eligible,liquidity_usd";
export const CRON_PRICE_PAGE = 80;

export async function listListedForPricing(opts: {
  afterAddress?: string | null;
  limit: number;
  onlyUnpriced?: boolean;
  minLiquidity?: number | null;
}): Promise<TokenRow[]> {
  if (!hasDatabase) return [];
  let request: any = db()
    .from("tokens")
    .select(PRICE_LIST_COLUMNS)
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .order("address", {ascending: true})
    .limit(opts.limit);
  request = applyUniverseFilter(request);
  if (opts.afterAddress) request = request.gt("address", opts.afterAddress);
  if (opts.minLiquidity != null && opts.minLiquidity > 0) {
    request = request.gte("liquidity_usd", opts.minLiquidity);
  }
  const {data, error} = await request;
  if (error) throw error;
  const rows = (data as TokenRow[]) ?? [];
  if (!opts.onlyUnpriced || rows.length === 0) return rows;
  const stats = await statsFor(rows.map((row) => row.address));
  return rows.filter((row) => {
    const stat = stats.get(normalizeAddress(row.address));
    if (stat?.price_status === "no_pool" || stat?.price_status === "failed") {
      return false;
    }
    return stat?.priced_at == null;
  });
}

export async function cursorFor(name: string): Promise<bigint> {
  const held = await cursorsFor([name]);
  return held.get(name) ?? 0n;
}

export async function cursorsFor(names: string[]): Promise<Map<string, bigint>> {
  const map = new Map<string, bigint>();
  for (const name of names) map.set(name, 0n);
  if (!hasDatabase || names.length === 0) return map;
  const {data, error} = await db()
    .from("indexer_state")
    .select("name, last_block")
    .in("name", names);
  if (error) throw error;
  for (const row of (data ?? []) as {name: string; last_block: number | string | null}[]) {
    map.set(row.name, row.last_block ? BigInt(row.last_block) : 0n);
  }
  return map;
}

export async function writeCursors(rows: {name: string; block: bigint}[]): Promise<void> {
  if (!hasDatabase || rows.length === 0) return;
  const now = new Date().toISOString();
  const {error} = await db().from("indexer_state").upsert(
    rows.map((row) => ({
      name: row.name,
      last_block: Number(row.block),
      updated_at: now,
    })),
  );
  if (error) throw error;
}

export async function writeCursor(name: string, block: bigint): Promise<void> {
  await writeCursors([{name, block}]);
}

export async function readLiveTipHeartbeat(): Promise<{
  last_run_at: string | null;
  blocks_behind: number | null;
} | null> {
  if (!hasDatabase) return null;
  const full = await db()
    .from("indexer_state")
    .select("last_block, updated_at, last_run_at, blocks_behind")
    .eq("name", "live-tip")
    .maybeSingle();
  if (full.error && /last_run_at|blocks_behind/i.test(full.error.message)) {
    const fallback = await db()
      .from("indexer_state")
      .select("last_block, updated_at")
      .eq("name", "live-tip")
      .maybeSingle();
    if (fallback.error || !fallback.data) return null;
    const row = fallback.data as {last_block: number | string | null; updated_at: string | null};
    return {
      last_run_at: row.updated_at ?? null,
      blocks_behind: row.last_block != null ? Number(row.last_block) : null,
    };
  }
  if (full.error || !full.data) return null;
  const row = full.data as {
    last_block: number | string | null;
    updated_at: string | null;
    last_run_at?: string | null;
    blocks_behind?: number | string | null;
  };
  return {
    last_run_at: row.last_run_at ?? row.updated_at ?? null,
    blocks_behind:
      row.blocks_behind != null
        ? Number(row.blocks_behind)
        : row.last_block != null
          ? Number(row.last_block)
          : null,
  };
}

export function rowToAsset(row: TokenRow, stats: TokenStatRow | undefined): TokenAsset {
  const address = normalizeAddress(row.address);
  const launchpad = launchpadFor(row.launchpad, address);
  const listed = isListed({
    launchpad: row.launchpad,
    quoteKind: row.quote_kind,
    rewardRwa: row.reward_rwa,
    bonded: Boolean(row.bonded_at) || row.launchpad === "long",
  });
  const priceRaw = stats?.last_price != null ? Number(stats.last_price) : null;
  const priced = priceRaw != null && Number.isFinite(priceRaw) && priceRaw > 0;
  const price = priced ? priceRaw : null;
  const supply = row.total_supply != null ? Number(row.total_supply) : null;
  const mcap = priced
    ? supply && price != null && price > 0
      ? Math.round(supply * price)
      : stats?.last_mcap != null
        ? Math.round(Number(stats.last_mcap))
        : null
    : null;
  const liqRaw = stats?.liquidity_usd ?? row.liquidity_usd;
  const liquidityUsd =
    liqRaw != null && Number.isFinite(Number(liqRaw)) ? Number(liqRaw) : null;
  const tradeable =
    row.is_tradeable != null
      ? row.is_tradeable
      : isTradeableFromLiquidity(liquidityUsd);

  return {
    kind: "token",
    id: address,
    address,
    symbol: row.symbol ?? "???",
    name: row.name ?? row.symbol ?? "Unknown",
    imageUrl: feedImageUrl(row),
    imageUrl64: isStoredImage(row.image_64) ? row.image_64 : null,
    imageFallbacks: tokenImageCandidates(row).slice(1),
    imageColor: hexColor(row.image_color),
    priceUsd: price,
    changePct: Number(stats?.price_change_24h ?? 0),
    volume24hUsd:
      stats?.vol_24h != null && Number(stats.vol_24h) > 0
        ? Math.round(Number(stats.vol_24h))
        : null,
    marketCapUsd: mcap != null && mcap > 0 ? mcap : null,
    circulatingSupply: supply,
    liquidityUsd: liquidityUsd != null ? Math.round(liquidityUsd) : null,
    tradeable,
    rewards24hUsd: Number(row.rewards_24h_usd ?? 0),
    rewardsToHolders: Boolean(row.reward_rwa),
    graduated: listed,
    graduatedOnChain: Boolean(row.bonded_at) || row.launchpad === "long",
    tradesOnUniswap: row.status === "listed",
    paysRwaRewards: Boolean(row.reward_rwa),
    windows: {
      "5m": {volumeUsd: 0, changePct: 0},
      "1h": {volumeUsd: 0, changePct: 0},
      "6h": {volumeUsd: 0, changePct: 0},
      "24h": {
        volumeUsd: Math.round(Number(stats?.vol_24h ?? 0)),
        changePct: Number(stats?.price_change_24h ?? 0),
      },
    },
    holders: 0,
    createdAt: row.created_at,
    listedAt: row.listed_at,
    pairedTicker:
      row.quote_kind === "rwa"
        ? (RWA_BY_ADDRESS.get(row.quote_token ?? "")?.ticker ??
          row.reward_rwa ??
          "")
        : row.quote_kind === "usdg"
          ? "USDG"
          : row.quote_kind === "eth"
            ? "WETH"
            : (row.quote_token ?? ""),
    rwaPaired: row.quote_kind === "rwa",
    buyTaxPct: row.tax_buy,
    sellTaxPct: row.tax_sell,
    feeSplit: null,
    launchpad,
    socials: {
      x: row.twitter ?? null,
      telegram: row.telegram ?? null,
      website: row.website ?? null,
      discord: row.discord ?? null,
    },
    description: `${row.name ?? row.symbol ?? "Token"} on ${launchpad?.name ?? "chain"}.`,
    series: [],
  };
}
