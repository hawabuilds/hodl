import type {NextRequest} from "next/server";
import {json, publicJson} from "@/lib/server/http";
import {searchUsers} from "@/lib/server/sources";
import {hasDatabase} from "@/lib/server/db";
import {searchUniverse} from "@/lib/server/live/search";
import {search as searchFallback} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q") ?? "";
  const withPeople = params.get("people") === "1";

  if (query.trim().length === 0) {
    return json({
      query,
      results: [],
      rwas: [],
      tokens: [],
      people: [],
      ineligible: false,
    });
  }

  const people = withPeople
    ? await searchUsers(query)
    : {data: [], seeded: false};

  if (hasDatabase) {
    try {
      const grouped = await searchUniverse(query, people.data);
      return publicJson(
        {
          query,
          results: grouped.results,
          rwas: grouped.rwas,
          tokens: grouped.tokens,
          people: grouped.people,
          ineligible: grouped.ineligible,
          seeded: false,
        },
        {maxAge: 15, swr: 60},
      );
    } catch (error) {
      console.error("search failed", error);
      return json({error: "Couldn't search. Retrying.", empty: false}, 503);
    }
  }

  const assets = await searchFallback(query);
  return publicJson(
    {
      query,
      results: assets.data,
      rwas: assets.data.filter((asset) => asset.kind === "rwa"),
      tokens: assets.data.filter((asset) => asset.kind === "token"),
      people: people.data,
      ineligible: false,
      seeded: assets.seeded,
    },
    {maxAge: 30, swr: 300},
  );
}
