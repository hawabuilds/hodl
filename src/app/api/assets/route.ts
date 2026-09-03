import type {NextRequest} from "next/server";
import {badRequest, json, parseKind} from "@/lib/server/http";
import {seriesFor} from "@/lib/server/market";
import {fetchAsset} from "@/lib/server/sources";
import type {Asset, Range} from "@/lib/types";
import {RANGES} from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_IDS = 60;

/**
 * Batch lookup, keyed `kind:id`.
 *
 * The portfolio needs the live price and the day's series for every position at
 * once; asking for them one request at a time would put a dozen round trips in
 * front of the first number someone sees.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raw = params.get("ids") ?? "";
  // The portfolio line is the sum of its positions, so each one has to be
  // sampled over the same window the chart is showing.
  const range = RANGES.find((r) => r === params.get("range")) as Range | undefined;
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0) return json({assets: []});
  if (keys.length > MAX_IDS) return badRequest(`At most ${MAX_IDS} ids.`);

  const assets = await Promise.all(
    keys.map(async (key) => {
      const separator = key.indexOf(":");
      if (separator === -1) return null;
      const kind = parseKind(key.slice(0, separator));
      if (!kind) return null;
      const {data} = await fetchAsset(kind, key.slice(separator + 1));
      if (!data || !range) return data;
      return {...data, series: seriesFor(data, range)};
    }),
  );

  return json({assets: assets.filter((asset): asset is Asset => asset !== null)});
}
