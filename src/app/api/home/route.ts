import {NextRequest} from "next/server";

import {GET as chartRoute} from "@/app/api/asset/[kind]/[id]/chart/route";
import {GET as marketRoute} from "@/app/api/market/route";
import {GET as newsRoute} from "@/app/api/news/route";
import {GET as newTokensRoute} from "@/app/api/tokens/new/route";
import {RANGE_SOURCE} from "@/lib/homeSummary";
import {homeFeatured} from "@/lib/server/homeFeatured";
import {NEWS_DEFAULT_TOPIC, NEWS_DEFAULT_WINDOW} from "@/lib/newsWindow";
import {PAGE_EDGE, publicJson} from "@/lib/server/http";
import type {RwaAsset, TokenAsset} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Desktop Home in one request: both market lists, the newest launches, the
 * news and the featured stock's chart — the same responses the cards' own
 * requests return, built by the same route handlers (and so the same caches),
 * so the page can paint every card at once.
 *
 * A part that takes longer than PART_BUDGET_MS is left out as null rather than
 * holding the rest; that card then fetches for itself. The whole answer is the
 * same for every reader and is held at the edge like the lists it is made of.
 */
const PART_BUDGET_MS = 1_500;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function body<T>(response: Response): Promise<T | null> {
  return response.ok ? ((await response.json()) as T) : null;
}

const call = (origin: string, path: string) => new NextRequest(new URL(path, origin));

interface MarketBody {
  rwas: RwaAsset[];
  tokens: TokenAsset[];
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const featuredTimeframe = RANGE_SOURCE["1D"].timeframe;

  const [trending, volume, newTokens, news, featured] = await Promise.all([
    within(marketRoute(call(origin, "/api/market?sort=trending")).then((r) => body<MarketBody>(r)), PART_BUDGET_MS),
    within(marketRoute(call(origin, "/api/market?sort=volume")).then((r) => body<MarketBody>(r)), PART_BUDGET_MS),
    within(newTokensRoute(call(origin, "/api/tokens/new")).then((r) => body<unknown>(r)), PART_BUDGET_MS),
    within(
      newsRoute(call(origin, `/api/news?window=${NEWS_DEFAULT_WINDOW}&topic=${NEWS_DEFAULT_TOPIC}`)).then((r) =>
        body<unknown>(r),
      ),
      PART_BUDGET_MS,
    ),
    // The RWA whose paired tokens traded most today, from the tokens table.
    within(homeFeatured(), PART_BUDGET_MS),
  ]);

  const leadId = featured?.ticker ? featured.ticker.toLowerCase() : null;
  const chart = leadId
    ? await within(
        chartRoute(call(origin, `/api/asset/rwa/${leadId}/chart?tf=${featuredTimeframe}`), {
          params: Promise.resolve({kind: "rwa", id: leadId}),
        }).then((r) => body<unknown>(r)),
        PART_BUDGET_MS,
      )
    : null;

  return publicJson(
    {
      market: {trending, volume},
      newTokens,
      news: news ? {window: NEWS_DEFAULT_WINDOW, topic: NEWS_DEFAULT_TOPIC, body: news} : null,
      featured,
      chart: chart && leadId ? {id: leadId, timeframe: featuredTimeframe, body: chart} : null,
      builtAt: Date.now(),
    },
    PAGE_EDGE,
  );
}
