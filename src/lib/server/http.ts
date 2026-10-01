import {NextResponse} from "next/server";
import type {AssetKind, Timeframe} from "@/lib/types";
import {TIMEFRAMES} from "@/lib/types";

/**
 * Shared route helpers.
 *
 * `json` is `no-store` by default, which is the right default for anything
 * about a particular person — a wallet's holdings, a follower list — and the
 * wrong one for market data, where it meant every reader in every country ran
 * a function in Virginia to be told the same thing.
 */
export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

/**
 * A response the CDN may hold and serve to anyone.
 *
 * `s-maxage` is how long an edge copy counts as fresh;
 * `stale-while-revalidate` is how long past that it may still be served while a
 * fresh one is fetched behind the reader. Between them a request from Sydney is
 * answered by the nearest edge rather than by a round trip to the function
 * region — and most requests never reach a function at all.
 *
 * Only for data that is identical for every reader. Anything keyed to a signed
 * in account must stay on `json`, or one person's page is served to the next.
 */
export function publicJson<T>(
  data: T,
  {
    /** Seconds an edge copy is fresh. */
    maxAge,
    /** Seconds it may be served stale while being refreshed. */
    swr = maxAge * 10,
    status = 200,
  }: {maxAge: number; swr?: number; status?: number},
) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`,
    },
  });
}

/**
 * Edge caching for page data that is the same for every reader (market lists,
 * the Tokens table's public tabs, the RWAs list): fresh for 10s, then served
 * stale for up to an hour while one request refreshes it in the background.
 * Each edge location keeps its own copy, and the cron warms only the one
 * nearest Railway — at ten minutes a quiet spell left a visitor's nearest
 * edge empty, and their first page waited on a cold function.
 */
export const PAGE_EDGE = {maxAge: 10, swr: 3600} as const;

/** A stable cache key for a query string: same params in any order, same key. */
export function queryKey(prefix: string, params: URLSearchParams): string {
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${new URLSearchParams(pairs).toString()}`;
}

export function badRequest(message: string) {
  return json({error: message}, 400);
}

export function notFound(message = "Not found") {
  return json({error: message}, 404);
}

export function parseKind(value: string): AssetKind | null {
  return value === "rwa" || value === "token" ? value : null;
}

export function parseTimeframe(value: string | null): Timeframe {
  const match = TIMEFRAMES.find((tf) => tf === value);
  return match ?? "1h";
}
