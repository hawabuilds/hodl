import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {hasDatabase} from "@/lib/server/db";
import {listRwas} from "@/lib/server/live/market";
import {loadDecoratedFeedPage} from "@/lib/server/live/feedDecorate";
import type {FeedSort} from "@/lib/server/live/universeStore";
import type {RwaAsset} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type MarketSort = "volume" | "marketCap" | "change" | "new" | "rewards";

function feedSort(sort: MarketSort): FeedSort {
  if (sort === "new") return "new";
  if (sort === "marketCap") return "mcap";
  if (sort === "rewards") return "rewards";
  return "volume";
}

function sortRwas(rwas: RwaAsset[], sort: MarketSort): RwaAsset[] {
  const copy = [...rwas];
  if (sort === "change") {
    return copy.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  }
  if (sort === "marketCap") {
    return copy.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  }
  return copy.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

/**
 * Home feed page. Decorates only the rows this tab will paint.
 * A timeout here is an error — never a seeded list.
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  const sort = (request.nextUrl.searchParams.get("sort") ?? "volume") as MarketSort;

  if (!hasDatabase) {
    return json(
      {
        error: "Market store is not configured.",
        empty: true,
      },
      503,
    );
  }

  try {
    const minLiq = Number(request.nextUrl.searchParams.get("minLiq"));
    const maxLiq = Number(request.nextUrl.searchParams.get("maxLiq"));
    const minMcap = Number(request.nextUrl.searchParams.get("minMcap"));
    const maxMcap = Number(request.nextUrl.searchParams.get("maxMcap"));
    const minVol = Number(request.nextUrl.searchParams.get("minVol"));
    const maxVol = Number(request.nextUrl.searchParams.get("maxVol"));
    const minAge = Number(request.nextUrl.searchParams.get("minAge"));
    const maxAge = Number(request.nextUrl.searchParams.get("maxAge"));
    const bound = (value: number) =>
      Number.isFinite(value) && value > 0 ? value : null;
    const [rwaSettled, pageSettled] = await Promise.allSettled([
      listRwas(),
      loadDecoratedFeedPage({
        sort: feedSort(sort),
        limit: 50,
        minLiquidity: bound(minLiq),
        maxLiquidity: bound(maxLiq),
        minMarketCap: bound(minMcap),
        maxMarketCap: bound(maxMcap),
        minVolume: bound(minVol),
        maxVolume: bound(maxVol),
        minAgeHours: bound(minAge),
        maxAgeHours: bound(maxAge),
      }),
    ]);
    const rwas = rwaSettled.status === "fulfilled" ? rwaSettled.value : [];
    const page =
      pageSettled.status === "fulfilled"
        ? pageSettled.value
        : {tokens: [], decorateMs: 0};
    if (rwaSettled.status === "rejected") {
      console.error("market rwas failed", rwaSettled.reason);
    }
    if (pageSettled.status === "rejected") {
      console.error("market tokens failed", pageSettled.reason);
    }
    const ms = Date.now() - started;
    console.info(
      `market page sort=${sort} rwas=${rwas.length} tokens=${page.tokens.length} decorateMs=${page.decorateMs} totalMs=${ms}`,
    );
    return json({
      rwas: sortRwas(rwas, sort),
      tokens: page.tokens,
      seeded: false,
      asOf: Date.now(),
      ms,
      decorateMs: page.decorateMs,
    });
  } catch (error) {
    console.error("market page failed", error);
    return json(
      {
        error: "Couldn't load the market. Retrying.",
        empty: false,
      },
      503,
    );
  }
}
