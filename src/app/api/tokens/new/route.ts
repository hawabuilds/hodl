import type {NextRequest} from "next/server";
import {PAGE_EDGE, json, publicJson, queryKey} from "@/lib/server/http";
import {cachedPage} from "@/lib/server/live/cache";
import {hasDatabase} from "@/lib/server/db";
import {loadDecoratedFeedPage} from "@/lib/server/live/feedDecorate";
import type {QuoteKind} from "@/lib/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How long a built page of new listings is reused before one request rebuilds it. */
const NEW_TTL_MS = 8_000;

/** Newest listings. The same for every reader: built every few seconds, held at the edge. */
export async function GET(request: NextRequest) {
  if (!hasDatabase) {
    return json({error: "Token store is not configured.", empty: true}, 503);
  }
  try {
    const body = await cachedPage(queryKey("page:tokens-new", request.nextUrl.searchParams), NEW_TTL_MS, () =>
      buildNew(request),
    );
    return publicJson(body, PAGE_EDGE);
  } catch (error) {
    console.error("tokens/new failed", error);
    return json({error: "Couldn't load new tokens. Retrying.", empty: false}, 503);
  }
}

async function buildNew(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawCursor = params.get("cursor") ?? "";
  const [cursorListedAt, cursorAddress] = rawCursor.includes("|")
    ? rawCursor.split("|")
    : [null, null];
  const launchpad = params.get("launchpad");
  const quote = params.get("quote");
  const limit = Number(params.get("limit") ?? 50);
  const started = Date.now();

  {
    const page = await loadDecoratedFeedPage({
      sort: "new",
      cursorListedAt,
      cursorAddress,
      limit,
      launchpad: launchpad === "pons" || launchpad === "long" ? launchpad : null,
      quoteKind:
        quote === "rwa" || quote === "eth" || quote === "usdg"
          ? (quote as QuoteKind)
          : null,
      rewardsOnly: params.get("rewards") === "rwa" || params.get("rewards") === "1",
      minLiquidity: params.get("minLiq") ? Number(params.get("minLiq")) : null,
      maxLiquidity: params.get("maxLiq") ? Number(params.get("maxLiq")) : null,
      minMarketCap: params.get("minMcap") ? Number(params.get("minMcap")) : null,
      maxMarketCap: params.get("maxMcap") ? Number(params.get("maxMcap")) : null,
      minVolume: params.get("minVol") ? Number(params.get("minVol")) : null,
      maxVolume: params.get("maxVol") ? Number(params.get("maxVol")) : null,
      minAgeHours: params.get("minAge") ? Number(params.get("minAge")) : null,
      maxAgeHours: params.get("maxAge") ? Number(params.get("maxAge")) : null,
    });
    const ms = Date.now() - started;
    console.info(
      `tokens/new page=${page.tokens.length} decorateMs=${page.decorateMs} totalMs=${ms}`,
    );
    return {
      tokens: page.tokens,
      cursor: page.cursor,
      hasMore: page.hasMore,
      ms,
      decorateMs: page.decorateMs,
    };
  }
}
