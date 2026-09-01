import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {search} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/** Tickers, symbols, names and contract addresses, across both sides. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.trim().length === 0) return json({query, results: []});

  const {data, seeded} = await search(query);
  return json({query, results: data, seeded});
}
