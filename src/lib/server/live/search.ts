import type {Asset, Profile, RwaAsset, TokenAsset} from "@/lib/types";
import {RWA_REGISTRY, RWA_BY_TICKER} from "./robinhood";
import {listRwas} from "./market";
import {
  getTokenRow,
  searchTokenRows,
  statsFor,
  rowToAsset,
} from "./universeStore";
import {isListed} from "@/lib/universe";
import {isAddress, normalizeAddress} from "@/lib/address";
import {showsThreeState} from "@/lib/threeState";
import {qualifyAndInsert} from "./qualify";
import {hasDatabase} from "../db";
import {searchCategory} from "@/lib/searchable";

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

  const tokenRows = hasDatabase ? await searchTokenRows(q) : [];
  const stats = await statsFor(tokenRows.map((row) => row.address));
  const tokenHits = tokenRows
    .filter((row) => listedRow(row))
    .map((row) => rowToAsset(row, stats.get(normalizeAddress(row.address))))
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
