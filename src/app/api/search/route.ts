import type {NextRequest} from "next/server";
import {json, publicJson} from "@/lib/server/http";
import {search, searchUsers} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/**
 * Tickers, symbols, names, contract addresses and people.
 *
 * People are only looked up when asked for, so the feed's own search bar — which
 * wants assets and nothing else — does not pay for a profile scan on every
 * keystroke.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q") ?? "";
  const withPeople = params.get("people") === "1";

  if (query.trim().length === 0) {
    return json({query, results: [], people: []});
  }

  const [assets, people] = await Promise.all([
    search(query),
    withPeople ? searchUsers(query) : Promise.resolve({data: [], seeded: true}),
  ]);

  return publicJson({
    query,
    results: assets.data,
    people: people.data,
    seeded: assets.seeded,
  }, {maxAge: 30, swr: 300});
}
