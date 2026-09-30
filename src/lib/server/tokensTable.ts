import {isAddress, normalizeAddress} from "@/lib/address";
import {
  TOKENS_PAGE_SIZE,
  type TokensCursor,
  type TokensPage,
  type TokensSort,
  type TokensTab,
  type TokensTableRow,
} from "@/lib/tokensTable";
import type {TokenAsset} from "@/lib/types";
import {db, hasDatabase} from "@/lib/server/db";
import {cached} from "@/lib/server/live/cache";
import {decorateTokenAssets} from "@/lib/server/live/feedDecorate";
import {RWA_BY_ADDRESS, RWA_BY_TICKER} from "@/lib/server/live/robinhood";
import {
  getTokenRows,
  listTokensPage,
  rowToAsset,
  statsFor,
  type TokenRow,
  type TokenStatRow,
} from "@/lib/server/live/universeStore";

/**
 * The desktop Tokens table: one page of one tab, sorted on the server.
 *
 * Trending and New page through `hodl_token_page` (scripts/schema-tokens-table.sql),
 * keyset on the sorted value so every page costs the same and every token is
 * reachable. Watchlist pages the same function over the starred addresses.
 * Following sorts by each token's latest HODL trade by a followed person, or by
 * any column. Each page is then decorated from DexScreener, as every list is,
 * which also saves its buy / sell counts for the next sort.
 */

type Universe = "trending" | "new" | "set";

const DAY_MS = 24 * 60 * 60 * 1000;

function inUniverse(row: TokenRow): boolean {
  return (
    row.status === "listed" &&
    (row.launchpad === "pons" || row.launchpad === "long") &&
    (row as {eligible?: boolean | null}).eligible !== false
  );
}

/** Tokens people the caller follows traded on HODL in the last day, newest trade first. */
async function followingTrades(callerId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!hasDatabase) return out;
  const {data: edges, error} = await db()
    .from("follows")
    .select("following_id")
    .eq("follower_id", callerId);
  if (error) throw error;
  const ids = [...new Set((edges ?? []).map((row) => String(row.following_id)))].filter(
    (id) => id !== callerId,
  );
  if (ids.length === 0) return out;
  const trades = await db()
    .from("hodl_trades")
    .select("asset_id, traded_at")
    .eq("kind", "token")
    .in("user_id", ids)
    .gte("traded_at", new Date(Date.now() - DAY_MS).toISOString())
    .order("traded_at", {ascending: false})
    .limit(1000);
  if (trades.error) {
    // Before scripts/schema-following.sql there are no recorded trades.
    if (/hodl_trades/i.test(trades.error.message)) return out;
    throw trades.error;
  }
  for (const row of trades.data ?? []) {
    const address = normalizeAddress(String(row.asset_id));
    if (!out.has(address)) out.set(address, String(row.traded_at));
  }
  return out;
}

function missingFunction(error: {code?: string; message?: string} | null): boolean {
  return Boolean(
    error && (error.code === "PGRST202" || /hodl_token_(page|pairs)/i.test(error.message ?? "")),
  );
}

/** One page of addresses in order, and the cursor for the next. */
async function pageAddresses(input: {
  universe: Universe;
  sort: Exclude<TokensSort, "recent">;
  desc: boolean;
  quote: string | null;
  addresses: string[] | null;
  cursor: TokensCursor | null;
}): Promise<{addresses: string[]; next: TokensCursor | null}> {
  const after = input.cursor && "a" in input.cursor ? input.cursor : null;
  const {data, error} = await db().rpc("hodl_token_page", {
    p_universe: input.universe,
    p_sort: input.sort,
    p_desc: input.desc,
    p_quote: input.quote,
    p_addresses: input.addresses,
    p_after_key: after && !after.n ? after.k : null,
    p_after_address: after ? after.a : null,
    p_after_null: after ? after.n : false,
    p_limit: TOKENS_PAGE_SIZE,
  });
  if (missingFunction(error)) return fallbackPage(input);
  if (error) throw error;
  const rows = (data ?? []) as {address: string; sort_key: string | null}[];
  const last = rows[rows.length - 1];
  return {
    addresses: rows.map((row) => normalizeAddress(row.address)),
    next:
      rows.length === TOKENS_PAGE_SIZE && last
        ? {k: last.sort_key, a: last.address, n: last.sort_key == null}
        : null,
  };
}

const SORT_VALUE: Record<Exclude<TokensSort, "recent">, (row: TokenRow, stat?: TokenStatRow) => number | null> = {
  age: (row) => (row.listed_at ? Date.parse(row.listed_at) : null),
  mcap: (_row, stat) => (stat?.last_mcap != null ? Number(stat.last_mcap) : null),
  change: (_row, stat) => (stat?.price_change_24h != null ? Number(stat.price_change_24h) : null),
  liq: (_row, stat) => (stat?.liquidity_usd != null ? Number(stat.liquidity_usd) : null),
  vol: (_row, stat) => (stat?.vol_24h != null ? Number(stat.vol_24h) : null),
  txns: (_row, stat) =>
    stat?.buys_24h != null && stat?.sells_24h != null ? stat.buys_24h + stat.sells_24h : null,
};

/**
 * Before scripts/schema-tokens-table.sql: sort a bounded candidate set in
 * memory (Trending's traded tokens, the 1,000 newest for New, or the given
 * set). Correct for everything it covers; New is limited to its newest 500
 * until the SQL runs.
 */
async function fallbackPage(input: {
  universe: Universe;
  sort: Exclude<TokensSort, "recent">;
  desc: boolean;
  quote: string | null;
  addresses: string[] | null;
  cursor: TokensCursor | null;
}): Promise<{addresses: string[]; next: TokensCursor | null}> {
  console.error("hodl_token_page missing — run scripts/schema-tokens-table.sql; sorting in memory");
  const candidates = await fallbackCandidates(input.universe, input.addresses);
  const [rows, stats] = await Promise.all([rowsFor(candidates), statsFor(candidates)]);
  const value = SORT_VALUE[input.sort];
  const ranked = rows
    .filter((row) => inUniverse(row) && (!input.quote || normalizeAddress(row.quote_token ?? "") === input.quote))
    .map((row) => ({address: normalizeAddress(row.address), v: value(row, stats.get(normalizeAddress(row.address)))}))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? a.address.localeCompare(b.address) : 1) : -1;
      return (input.desc ? b.v - a.v : a.v - b.v) || a.address.localeCompare(b.address);
    });
  const offset = input.cursor && "o" in input.cursor ? input.cursor.o : 0;
  const slice = ranked.slice(offset, offset + TOKENS_PAGE_SIZE);
  return {
    addresses: slice.map((row) => row.address),
    next: offset + TOKENS_PAGE_SIZE < ranked.length ? {o: offset + TOKENS_PAGE_SIZE} : null,
  };
}

/** What the in-memory fallback sorts: bounded, and shared a minute. */
function fallbackCandidates(universe: Universe, addresses: string[] | null): Promise<string[]> {
  if (addresses) return Promise.resolve(addresses);
  return cached(`tokens-table:fallback:${universe}`, 60_000, async () => {
    if (universe === "trending") {
      const {data, error} = await db()
        .from("token_stats")
        .select("address")
        .or(`vol_24h.gt.0,price_moved_at.gte.${new Date(Date.now() - DAY_MS).toISOString()}`)
        .gte("updated_at", new Date(Date.now() - DAY_MS).toISOString())
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((row) => normalizeAddress(String(row.address)));
    }
    // The New feed's own query is quick without the new indexes; walk it
    // back a few pages rather than scanning the whole tokens table.
    const out: string[] = [];
    let cursorListedAt: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result = await listTokensPage({sort: "new", limit: 100, cursorListedAt});
      out.push(...result.rows.map((row) => normalizeAddress(row.address)));
      const last = result.rows[result.rows.length - 1];
      if (!result.next || !last?.listed_at) break;
      cursorListedAt = last.listed_at;
    }
    return out;
  });
}

async function rowsFor(addresses: string[]): Promise<TokenRow[]> {
  const out: TokenRow[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    out.push(...(await getTokenRows(addresses.slice(i, i + 100))));
  }
  return out;
}

/** "Paired with" chips for a tab: stocks with the most tokens first. */
async function pairsFor(universe: Universe, addresses: string[] | null): Promise<TokensPage["pairs"]> {
  const load = async () => {
    const {data, error} = await db().rpc("hodl_token_pairs", {
      p_universe: universe,
      p_addresses: addresses,
    });
    let counts: {quote_token: string; tokens: number}[];
    if (missingFunction(error)) {
      // Before the SQL: count over the fallback's candidates.
      const rows = (await rowsFor(await fallbackCandidates(universe, addresses))).filter(
        (row) => inUniverse(row) && row.quote_kind === "rwa" && row.quote_token,
      );
      const tally = new Map<string, number>();
      for (const row of rows) {
        const quote = normalizeAddress(row.quote_token!);
        tally.set(quote, (tally.get(quote) ?? 0) + 1);
      }
      counts = [...tally.entries()]
        .map(([quote_token, tokens]) => ({quote_token, tokens}))
        .sort((x, y) => y.tokens - x.tokens);
    } else if (error) {
      throw error;
    } else {
      counts = ((data ?? []) as {quote_token: string; tokens: number | string}[]).map((row) => ({
        quote_token: row.quote_token,
        tokens: Number(row.tokens),
      }));
    }
    return counts
      .map((row) => ({ticker: RWA_BY_ADDRESS.get(normalizeAddress(row.quote_token))?.ticker ?? null, count: row.tokens}))
      .filter((row): row is {ticker: string; count: number} => row.ticker != null);
  };
  // Trending and New are the same for everyone, so they are shared a while.
  return universe === "set" ? load() : cached(`tokens-table:pairs:${universe}`, 120_000, load);
}

/** Rows in the given order, decorated from DexScreener like every list. */
async function buildRows(addresses: string[], tradedAt?: Map<string, string>): Promise<TokensTableRow[]> {
  if (addresses.length === 0) return [];
  const [rows, stats] = await Promise.all([rowsFor(addresses), statsFor(addresses)]);
  const assets = rows.map((row) => rowToAsset(row, stats.get(normalizeAddress(row.address))));
  let decorated: TokenAsset[] = assets;
  try {
    decorated = await decorateTokenAssets(assets);
  } catch (error) {
    console.error("tokens table decorate failed; serving stored rows", error);
  }
  const byAddress = new Map(decorated.map((asset) => [normalizeAddress(asset.address), asset]));
  return addresses.flatMap((address) => {
    const asset = byAddress.get(address);
    if (!asset) return [];
    const day = asset.windows?.["24h"];
    return [
      {
        asset,
        buys: day?.buys ?? null,
        sells: day?.sells ?? null,
        tradedAt: tradedAt?.get(address) ?? null,
      },
    ];
  });
}

export async function tokensTablePage(input: {
  tab: TokensTab;
  sort: TokensSort;
  desc: boolean;
  stock: string | null;
  cursor: TokensCursor | null;
  watch: string[];
  callerId: string | null;
}): Promise<TokensPage> {
  if (!hasDatabase) return {rows: [], next: null, pairs: []};
  const quote = input.stock
    ? (RWA_BY_TICKER.get(input.stock.toUpperCase())?.address.toLowerCase() ?? "0x0")
    : null;

  let universe: Universe = input.tab === "new" ? "new" : "trending";
  let addresses: string[] | null = null;
  let tradedAt: Map<string, string> | undefined;

  if (input.tab === "watchlist") {
    universe = "set";
    addresses = input.watch.filter((id) => isAddress(id)).map(normalizeAddress);
  } else if (input.tab === "following") {
    universe = "set";
    tradedAt = input.callerId ? await followingTrades(input.callerId) : new Map();
    addresses = [...tradedAt.keys()];
  }

  const firstPage = input.cursor == null;
  if (addresses && addresses.length === 0) {
    return {rows: [], next: null, pairs: firstPage ? [] : undefined};
  }

  let page: {addresses: string[]; next: TokensCursor | null};
  if (input.sort === "recent") {
    // Following's default: newest trade first, within the tab and stock filter.
    const ordered = [...(tradedAt ?? new Map()).entries()]
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .map(([address]) => address);
    const rows = await rowsFor(ordered);
    const allowed = new Set(
      rows
        .filter((row) => inUniverse(row) && (!quote || normalizeAddress(row.quote_token ?? "") === quote))
        .map((row) => normalizeAddress(row.address)),
    );
    const eligible = ordered.filter((address) => allowed.has(address));
    const offset = input.cursor && "o" in input.cursor ? input.cursor.o : 0;
    page = {
      addresses: eligible.slice(offset, offset + TOKENS_PAGE_SIZE),
      next: offset + TOKENS_PAGE_SIZE < eligible.length ? {o: offset + TOKENS_PAGE_SIZE} : null,
    };
  } else {
    page = await pageAddresses({
      universe,
      sort: input.sort,
      desc: input.desc,
      quote,
      addresses,
      cursor: input.cursor,
    });
  }

  const [rows, pairs] = await Promise.all([
    buildRows(page.addresses, tradedAt),
    firstPage ? pairsFor(universe, addresses) : Promise.resolve(undefined),
  ]);
  return {rows, next: page.next, pairs};
}
