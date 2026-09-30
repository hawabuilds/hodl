/**
 * A stock's real market move: its last price against the previous close, as
 * Robinhood reports them. The on-chain token's own pool price is not used —
 * pools on this chain are too thin to say how a stock did today.
 *
 * Kept pure so the session and fallback rules can be tested.
 */

export type RwaSession = "today" | "last";

export interface StockQuoteFields {
  /** Last regular-session trade. */
  last: number | null;
  previousClose: number | null;
  /** YYYY-MM-DD, the session `previousClose` closed. */
  previousCloseDate: string | null;
  /** ISO time of the last regular-session trade. */
  lastTradeAt: string | null;
}

export interface StockMove {
  priceUsd: number;
  changePct: number;
}

/** A New York calendar date and minutes past midnight for an instant. */
export function newYorkClock(at: Date): {date: string; minutes: number; weekday: number} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday,
  };
}

const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;
/** A market that has not printed a trade in this long is not open, whatever the clock says. */
const QUIET_MS = 15 * 60_000;

/**
 * "today" while the US market is in its regular session, "last" otherwise.
 * Holidays need no calendar: on a holiday nothing trades, so the newest trade
 * is old and the session reads as closed.
 */
export function marketSession(now: Date, newestTradeAt: string | null): RwaSession {
  const clock = newYorkClock(now);
  const weekday = clock.weekday >= 1 && clock.weekday <= 5;
  const hours = clock.minutes >= OPEN_MINUTES && clock.minutes < CLOSE_MINUTES;
  const newest = newestTradeAt ? Date.parse(newestTradeAt) : NaN;
  const trading = Number.isFinite(newest) && now.getTime() - newest < QUIET_MS;
  return weekday && hours && trading ? "today" : "last";
}

/**
 * The move for one stock.
 *
 * The quote's pair is used when its previous close is from an earlier session
 * than its last trade. Before the open, Robinhood can already have rolled the
 * previous close forward to the last session itself, which would read as a
 * flat 0%; then the last two daily closes say how that session went.
 */
export function stockMove(
  quote: StockQuoteFields | undefined,
  dailyCloses: number[] | undefined,
): StockMove | null {
  const last = quote?.last ?? null;
  const previous = quote?.previousClose ?? null;
  const tradeDate = quote?.lastTradeAt ? newYorkClock(new Date(quote.lastTradeAt)).date : null;
  const coherent =
    previous != null &&
    previous > 0 &&
    quote?.previousCloseDate != null &&
    tradeDate != null &&
    quote.previousCloseDate < tradeDate;
  if (last != null && last > 0 && coherent) {
    return {priceUsd: last, changePct: (last / previous - 1) * 100};
  }
  const closes = (dailyCloses ?? []).filter((close) => close > 0);
  if (closes.length >= 2) {
    const [before, latest] = closes.slice(-2);
    return {priceUsd: latest, changePct: (latest / before - 1) * 100};
  }
  return null;
}

/** Whether any stock needs the daily-close fallback. */
export function needsDailyCloses(quote: StockQuoteFields | undefined): boolean {
  if (!quote?.last || !quote.previousClose || !quote.previousCloseDate || !quote.lastTradeAt) return true;
  return quote.previousCloseDate >= newYorkClock(new Date(quote.lastTradeAt)).date;
}
