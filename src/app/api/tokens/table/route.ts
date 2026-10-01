import {PAGE_EDGE, json, publicJson, queryKey} from "@/lib/server/http";
import {cachedPage, readLastGood} from "@/lib/server/live/cache";
import {callerId} from "@/lib/server/auth";
import {tokensTablePage} from "@/lib/server/tokensTable";
import {decodeCursor, parseSort, parseTab, type TokensPage} from "@/lib/tokensTable";
import type {TokenAsset} from "@/lib/types";

/** How long a built public page (Trending, New) is reused before one request rebuilds it. */
const PUBLIC_TTL_MS = 10_000;

const cleanStock = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9.]{1,12}$/.test(value) ? value : null;

/**
 * Trending and New: the same rows for every reader, so a GET the edge can
 * hold. Built every 10s; the DexScreener round trip in the build happens
 * behind a served copy. Following and Watchlist, which depend on who is
 * asking, stay on POST below.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tab = parseTab(params.get("tab"));
  if (tab !== "trending" && tab !== "new") return json({error: "Use POST for this tab."}, 405);
  const sort = parseSort(params.get("sort"), tab);
  let cursor = null;
  try {
    cursor = decodeCursor(params.get("cursor") ? JSON.parse(params.get("cursor") as string) : null);
  } catch {
    cursor = null;
  }
  try {
    const body = await cachedPage(
      queryKey("page:tokens-table", params),
      PUBLIC_TTL_MS,
      () =>
        tokensTablePage({
          tab,
          sort,
          desc: params.get("dir") !== "asc",
          stock: cleanStock(params.get("stock")),
          cursor,
          watch: [],
          callerId: null,
        }),
      {standIn: () => (cursor || params.get("stock") ? Promise.resolve(null) : standInPage(tab, sort))},
    );
    return publicJson(body, PAGE_EDGE);
  } catch (error) {
    console.error("tokens table page failed", error);
    // Never built yet: stand in with the same tokens from the Market or New
    // listings copy (also used above while the first build is slow), so the
    // table shows rows rather than an error.
    const standIn = cursor || params.get("stock") ? null : await standInPage(tab, sort).catch(() => null);
    if (standIn) return json(standIn);
    return json({error: "Couldn't load tokens."}, 503);
  }
}

async function standInPage(tab: "trending" | "new", sort: string): Promise<TokensPage | null> {
  const key =
    tab === "new"
      ? queryKey("page:tokens-new", new URLSearchParams({limit: "50"}))
      : queryKey("page:market", new URLSearchParams({sort: "trending"}));
  const copy = await readLastGood<{tokens?: TokenAsset[]}>(key);
  const tokens = [...(copy?.tokens ?? [])];
  if (tokens.length === 0) return null;
  if (sort === "vol") tokens.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return {
    rows: tokens.map((asset) => ({
      asset,
      buys: asset.windows?.["24h"]?.buys ?? null,
      sells: asset.windows?.["24h"]?.sells ?? null,
      tradedAt: null,
    })),
    next: null,
    pairs: [],
  };
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One page of the desktop Tokens table. POST so a watchlist of any size fits
 * in the body. Following needs the caller; the other tabs do not.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tab = parseTab(body.tab);
  const sort = parseSort(body.sort, tab);
  const stock =
    typeof body.stock === "string" && /^[A-Za-z0-9.]{1,12}$/.test(body.stock) ? body.stock : null;
  const watch = Array.isArray(body.watch)
    ? body.watch.filter((id): id is string => typeof id === "string").slice(0, 500)
    : [];
  const caller = tab === "following" ? await callerId(request) : null;
  if (tab === "following" && !caller) {
    return json({rows: [], next: null, pairs: [], signedOut: true});
  }
  try {
    return json(
      await tokensTablePage({
        tab,
        sort,
        desc: body.dir !== "asc",
        stock,
        cursor: decodeCursor(body.cursor),
        watch,
        callerId: caller,
      }),
    );
  } catch (error) {
    console.error("tokens table page failed", error);
    return json({error: "Couldn't load tokens."}, 503);
  }
}
