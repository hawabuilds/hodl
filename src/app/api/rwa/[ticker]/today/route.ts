import {json, notFound} from "@/lib/server/http";
import {cached} from "@/lib/server/live/cache";
import {RWA_BY_TICKER, historicalCandles} from "@/lib/server/live/robinhood";

export const dynamic = "force-dynamic";

/** The market day a daily candle belongs to, in New York. */
function marketDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(new Date(ms));
}

/**
 * A stock's real market move: its latest daily close against the one before,
 * from Robinhood's price history — not the tokenized stock's DEX pool. Labelled
 * "today" when the latest candle is today's, otherwise "last session".
 */
export async function GET(_request: Request, context: {params: Promise<{ticker: string}>}) {
  const params = await context.params;
  const ticker = params.ticker.toUpperCase();
  if (!RWA_BY_TICKER.has(ticker)) return notFound("Unknown stock.");
  try {
    const result = await cached(`rwa-today:${ticker}`, 5 * 60_000, async () => {
      const {points} = await historicalCandles(ticker, "1D", 5);
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      if (!last || !prev || !(prev.price > 0)) return null;
      return {
        ticker,
        changePct: ((last.price - prev.price) / prev.price) * 100,
        label: marketDay(last.t) === marketDay(Date.now()) ? ("today" as const) : ("last session" as const),
      };
    });
    if (!result) return json({ticker, changePct: null, label: null});
    return json(result);
  } catch (error) {
    console.error("rwa today failed", ticker, error);
    return json({error: "Couldn't load the stock's move."}, 503);
  }
}
