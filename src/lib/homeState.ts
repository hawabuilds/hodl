import type {HomeTab} from "@/components/HomeTabs";
import {SECTORS, type SectorId} from "@/lib/sectors";

/**
 * The home feed's last view, so a chart page can send the visitor back to
 * New (or Watchlist, or RWAs) instead of a fresh `/home` that resets to
 * Trending.
 */

export const HOME_STATE_KEY = "rwa:home";

export type TokenSort = "new" | "trending" | "marketCap";
export type RwaSort = "marketCap" | "movers";
export type WatchFilter = "all" | "token" | "rwa";

export interface HomeViewState {
  tab: HomeTab;
  tokenSort: TokenSort;
  rwaSort: RwaSort;
  sector: SectorId | "all";
  watchFilter: WatchFilter;
  launchpad?: "pons" | "long" | "";
  quote?: "rwa" | "eth" | "usdg" | "";
  rewards?: boolean;
  minMcap?: number | null;
  maxMcap?: number | null;
  minLiq?: number | null;
  maxLiq?: number | null;
  minVol?: number | null;
  maxVol?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
}

export const DEFAULT_HOME_VIEW: HomeViewState = {
  tab: "tokens",
  tokenSort: "trending",
  rwaSort: "marketCap",
  sector: "all",
  watchFilter: "all",
};

const TABS: HomeTab[] = ["watchlist", "tokens", "rwas"];
// An old link to the removed Rewards sort parses to the default.
const TOKEN_SORTS: TokenSort[] = ["new", "trending", "marketCap"];
const RWA_SORTS: RwaSort[] = ["marketCap", "movers"];
const WATCH: WatchFilter[] = ["all", "token", "rwa"];
const SECTOR_VALUES = new Set<string>(["all", ...SECTORS.map((entry) => entry.id)]);

export function parseHomeView(
  params: {get: (key: string) => string | null},
  /** The tab a route opens on when the URL names none: /tokens or /rwas. */
  defaultTab: HomeTab = DEFAULT_HOME_VIEW.tab,
): HomeViewState {
  const tab = TABS.find((value) => value === params.get("tab"));
  const tokenSort = TOKEN_SORTS.find((value) => value === params.get("sort"));
  const rwaSort = RWA_SORTS.find((value) => value === params.get("rwaSort"));
  const watchFilter = WATCH.find((value) => value === params.get("watch"));
  const sectorRaw = params.get("sector");
  const sector =
    sectorRaw && SECTOR_VALUES.has(sectorRaw)
      ? (sectorRaw as SectorId | "all")
      : DEFAULT_HOME_VIEW.sector;

  const bound = (key: string): number | null => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const launchpadRaw = params.get("launchpad");
  const quoteRaw = params.get("quote");
  return {
    tab: tab ?? defaultTab,
    tokenSort: tokenSort ?? DEFAULT_HOME_VIEW.tokenSort,
    rwaSort: rwaSort ?? DEFAULT_HOME_VIEW.rwaSort,
    sector,
    watchFilter: watchFilter ?? DEFAULT_HOME_VIEW.watchFilter,
    launchpad: launchpadRaw === "pons" || launchpadRaw === "long" ? launchpadRaw : "",
    quote:
      quoteRaw === "rwa" || quoteRaw === "eth" || quoteRaw === "usdg" ? quoteRaw : "",
    rewards: params.get("rewards") === "rwa" || params.get("rewards") === "1",
    minMcap: bound("minMcap"),
    maxMcap: bound("maxMcap"),
    minLiq: bound("minLiq"),
    maxLiq: bound("maxLiq"),
    minVol: bound("minVol"),
    maxVol: bound("maxVol"),
    minAge: bound("minAge"),
    maxAge: bound("maxAge"),
  };
}

/** Query string for a view, empty when everything is at its default. */
export function homeQuery(
  state: HomeViewState,
  defaultTab: HomeTab = DEFAULT_HOME_VIEW.tab,
): string {
  const params = new URLSearchParams();
  if (state.tab !== defaultTab) params.set("tab", state.tab);
  if (state.tokenSort !== DEFAULT_HOME_VIEW.tokenSort) {
    params.set("sort", state.tokenSort);
  }
  if (state.rwaSort !== DEFAULT_HOME_VIEW.rwaSort) {
    params.set("rwaSort", state.rwaSort);
  }
  if (state.sector !== DEFAULT_HOME_VIEW.sector) {
    params.set("sector", state.sector);
  }
  if (state.watchFilter !== DEFAULT_HOME_VIEW.watchFilter) {
    params.set("watch", state.watchFilter);
  }
  if (state.launchpad) params.set("launchpad", state.launchpad);
  if (state.quote) params.set("quote", state.quote);
  if (state.rewards) params.set("rewards", "rwa");
  if (state.minMcap) params.set("minMcap", String(state.minMcap));
  if (state.maxMcap) params.set("maxMcap", String(state.maxMcap));
  if (state.minLiq) params.set("minLiq", String(state.minLiq));
  if (state.maxLiq) params.set("maxLiq", String(state.maxLiq));
  if (state.minVol) params.set("minVol", String(state.minVol));
  if (state.maxVol) params.set("maxVol", String(state.maxVol));
  if (state.minAge) params.set("minAge", String(state.minAge));
  if (state.maxAge) params.set("maxAge", String(state.maxAge));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Where "back" from a chart page goes: the list the visitor came from, whole.
 *
 * The feed moved from /home to /tokens and /rwas when Home became a summary,
 * so the path is stored with the query rather than assumed.
 */
export function rememberHomePath(path: string): void {
  try {
    sessionStorage.setItem(HOME_STATE_KEY, path);
  } catch {
    // Private mode — back still works via the URL itself.
  }
}

export function rememberHomeView(
  state: HomeViewState,
  pathname: string,
  defaultTab: HomeTab = DEFAULT_HOME_VIEW.tab,
): void {
  rememberHomePath(`${pathname}${homeQuery(state, defaultTab)}`);
}

export function lastHomePath(): string {
  try {
    const stored = sessionStorage.getItem(HOME_STATE_KEY) ?? "";
    if (stored.startsWith("/")) return stored;
    // Stored before the move: a bare query was the feed's, now at /tokens.
    return stored ? `/tokens${stored}` : "/home";
  } catch {
    return "/home";
  }
}
