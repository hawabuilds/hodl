import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {hasDatabase} from "@/lib/server/db";
import {loadDecoratedFeedPage} from "@/lib/server/live/feedDecorate";
import type {QuoteKind} from "@/lib/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!hasDatabase) {
    return json({error: "Token store is not configured.", empty: true}, 503);
  }

  const params = request.nextUrl.searchParams;
  const rawCursor = params.get("cursor") ?? "";
  const [cursorListedAt, cursorAddress] = rawCursor.includes("|")
    ? rawCursor.split("|")
    : [null, null];
  const launchpad = params.get("launchpad");
  const quote = params.get("quote");
  const limit = Number(params.get("limit") ?? 50);
  const started = Date.now();

  try {
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
    return json({
      tokens: page.tokens,
      cursor: page.cursor,
      hasMore: page.hasMore,
      ms,
      decorateMs: page.decorateMs,
    });
  } catch (error) {
    console.error("tokens/new failed", error);
    return json({error: "Couldn't load new tokens. Retrying.", empty: false}, 503);
  }
}
