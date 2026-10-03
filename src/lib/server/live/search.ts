import type {Asset, Profile, RwaAsset, TokenAsset} from "@/lib/types";
import {RWA_REGISTRY, RWA_BY_TICKER} from "./robinhood";
import {listRwas, searchableTokens} from "./market";
import {
  getTokenRow,
  getTokenRows,
  statsFor,
  rowToAsset,
} from "./universeStore";
import {cachedLocal, keepAlive} from "./cache";
import {isListed} from "@/lib/universe";
import {isAddress, normalizeAddress} from "@/lib/address";
import {showsThreeState} from "@/lib/threeState";
import {qualifyAndInsert} from "./qualify";
import {db, hasDatabase} from "../db";
import {searchCategory} from "@/lib/searchable";

/**
 * Tokens matching the query, from the cached search index (rebuilt at most
 * every few minutes, with a last good copy). Searching the tokens table per
 * keystroke was an `ilike` scan of every row — a full-table read for each
 * letter typed, by every reader.
 */
async function tokenCandidates(q: string): Promise<TokenAsset[]> {
  if (!hasDatabase) return [];
  const wanted = q.toLowerCase();
  const matches = (token: {address: string; symbol: string; name: string}) =>
    normalizeAddress(token.address) === wanted || scoreName(token.symbol, q) > 0 || scoreName(token.name, q) > 0;
  const [index, everyone] = await Promise.all([
    searchableTokens().catch(() => [] as TokenAsset[]),
    namesOrNull(),
  ]);
  const fromIndex = index.filter(matches);
  if (!everyone) return fromIndex;
  // Every listed token by name and ticker, not just the lists' tokens: the
  // index above is built from the Trending feed, so a token outside its first
  // page could not be found by name at all.
  const have = new Set(fromIndex.map((token) => normalizeAddress(token.address)));
  const extra = everyone
    .filter((entry) => !have.has(entry.address) && matches(entry))
    .map((entry) => ({entry, score: scoreName(entry.symbol, q) * 1.1 + scoreName(entry.name, q)}))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NAME_HITS)
    .map((row) => row.entry.address);
  if (extra.length === 0) return fromIndex;
  const [rows, stats] = await Promise.all([getTokenRows(extra), statsFor(extra)]);
  const found = rows
    .filter((row) => row.status === "listed")
    .map((row) => rowToAsset(row, stats.get(normalizeAddress(row.address))));
  return [...fromIndex, ...found];
}

interface NameEntry {
  address: string;
  symbol: string;
  name: string;
}

/** Tokens fetched in full for a query beyond the index's own matches. */
const MAX_NAME_HITS = 60;
/** How long a server keeps its list of every token's name. */
const NAME_INDEX_MS = 10 * 60_000;
/** How long a search waits on that list the first time a server builds it. */
const NAME_INDEX_PATIENCE_MS = 1_500;
const NAME_PAGE = 1_000;

/**
 * Name, ticker and address of every listed token (the Tokens table's
 * universe), held in this server's memory: ~38k short rows, read in pages,
 * so a name search is a scan of memory rather than of the tokens table.
 */
function nameIndex(): Promise<NameEntry[]> {
  return cachedLocal("search:name-index", NAME_INDEX_MS, async () => {
    const universe = () =>
      db()
        .from("tokens")
        .select("address, symbol, name")
        .eq("status", "listed")
        .in("launchpad", ["pons", "long"])
        .not("eligible", "is", false);
    const {count, error} = await db()
      .from("tokens")
      .select("address", {count: "exact", head: true})
      .eq("status", "listed")
      .in("launchpad", ["pons", "long"])
      .not("eligible", "is", false);
    if (error) throw new Error(error.message);
    const pages = Math.min(200, Math.ceil((count ?? 0) / NAME_PAGE));
    const out: NameEntry[] = [];
    for (let first = 0; first < pages; first += 4) {
      const batch = await Promise.all(
        Array.from({length: Math.min(4, pages - first)}, (_, k) =>
          universe()
            .order("address")
            .range((first + k) * NAME_PAGE, (first + k + 1) * NAME_PAGE - 1),
        ),
      );
      for (const page of batch) {
        if (page.error) throw new Error(page.error.message);
        for (const row of (page.data ?? []) as {address: string; symbol: string | null; name: string | null}[]) {
          out.push({address: normalizeAddress(row.address), symbol: row.symbol ?? "", name: row.name ?? ""});
        }
      }
    }
    return out;
  });
}

/** The name list, or null while a cold server is still building it. */
async function namesOrNull(): Promise<NameEntry[] | null> {
  const building = nameIndex();
  keepAlive(building);
  return Promise.race([
    building.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), NAME_INDEX_PATIENCE_MS)),
  ]);
}

export interface GroupedSearch {
  query: string;
  rwas: RwaAsset[];
  tokens: TokenAsset[];
  people: Profile[];
  results: Asset[];
  ineligible: boolean;
  notFound: boolean;
}

function listedRow(row: Awaited<ReturnType<typeof getTokenRow>>): boolean {
  if (!row?.launchpad || !showsThreeState(row.eligible)) return false;
  if (row.eligible == null) return row.status === "listed";
  return isListed({
    launchpad: row.launchpad,
    quoteKind: row.quote_kind,
    rewardRwa: row.reward_rwa,
    bonded: Boolean(row.bonded_at) || row.launchpad === "long",
  });
}

function scoreName(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(/[^a-z0-9]+/);
  if (words.some((word) => word === q)) return 70;
  if (words.some((word) => word.startsWith(q))) return 50;
  if (n.includes(q)) return 30;
  return 0;
}

/**
 * Search the universe in Supabase. DexScreener is never asked for a list.
 */
export async function searchUniverse(
  query: string,
  people: Profile[],
): Promise<GroupedSearch> {
  const q = query.trim();
  const empty: GroupedSearch = {
    query: q,
    rwas: [],
    tokens: [],
    people: [],
    results: [],
    ineligible: false,
    notFound: true,
  };
  if (!q) return empty;

  const category = searchCategory(q);
  const rwas = await listRwas();

  if (isAddress(q)) {
    const address = normalizeAddress(q);
    if (hasDatabase) {
      const row = await getTokenRow(address);
      if (listedRow(row) && row) {
        const stats = await statsFor([address]);
        const token = rowToAsset(row, stats.get(address));
        return {
          query: q,
          rwas: [],
          tokens: [token],
          people,
          results: [token],
          ineligible: false,
          notFound: false,
        };
      }
      const live = await qualifyAndInsert(address);
      if (live.status === "listed") {
        const stored = await getTokenRow(live.address);
        if (stored && listedRow(stored)) {
          const stats = await statsFor([stored.address]);
          const token = rowToAsset(stored, stats.get(stored.address));
          return {
            query: q,
            rwas: [],
            tokens: [token],
            people,
            results: [token],
            ineligible: false,
            notFound: false,
          };
        }
      }
      if (live.status === "ineligible") {
        return {...empty, ineligible: true, notFound: false, people};
      }
    }
    return {...empty, people};
  }

  const ticker = q.toUpperCase();
  const exactRwa = RWA_BY_TICKER.get(ticker);
  const rwaHits = rwas
    .map((asset) => ({
      asset,
      score:
        asset.ticker.toLowerCase() === q.toLowerCase()
          ? 200
          : scoreName(asset.name, q) + scoreName(asset.ticker, q),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.asset);

  if (exactRwa) {
    const lead = rwas.find((asset) => asset.ticker === exactRwa.ticker);
    if (lead) {
      const rest = rwaHits.filter((asset) => asset.ticker !== lead.ticker);
      rwaHits.splice(0, rwaHits.length, lead, ...rest);
    }
  }

  const tokenHits = (await tokenCandidates(q))
    .map((token) => ({
      token,
      score:
        token.symbol.toLowerCase() === q.toLowerCase()
          ? 180
          : scoreName(token.symbol, q) * 1.1 + scoreName(token.name, q),
    }))
    .filter((row) => row.score > 0 || !category)
    .sort((a, b) => {
      const rank = (token: TokenAsset) => (token.tradeable === false ? 0 : 1);
      const byTradeable = rank(b.token) - rank(a.token);
      if (byTradeable !== 0) return byTradeable;
      return b.score - a.score;
    })
    .map((row) => row.token);

  // Category words must never outrank a real ticker.
  if (category && exactRwa) {
    // ticker already leads rwaHits
  }

  const results: Asset[] = [];
  const seen = new Set<string>();
  for (const asset of [...rwaHits, ...tokenHits]) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    results.push(asset);
  }

  return {
    query: q,
    rwas: rwaHits.slice(0, 20),
    tokens: tokenHits.slice(0, 40),
    people,
    results: results.slice(0, 40),
    ineligible: false,
    notFound: results.length === 0 && people.length === 0,
  };
}

export {RWA_REGISTRY};
