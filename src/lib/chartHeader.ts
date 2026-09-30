import {launchPrintPrice} from "./chartLwc";
import type {Asset, ChartPoint, Trade} from "./types";

/**
 * The change shown beside the price at the top of a chart page.
 *
 * It used to be first-to-last over whatever the chart had loaded and was
 * labelled with the candle size, so a token up 14,851% since July read as up
 * 14,851% in the last hour. Now it is always one fixed span, named for what
 * it is: the last 24 hours, or since launch for a token younger than that.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The price 24 hours ago, from hourly bars: the close of the last bar that had
 * ended by then. A bar days older still counts — no trades since means the
 * price then was that close. Null when the bars start after that moment.
 */
export function priceDayAgo(hourly: readonly ChartPoint[], now: number): number | null {
  const cutoff = now - DAY_MS;
  let found: ChartPoint | null = null;
  for (const bar of hourly) {
    if (bar.t + HOUR_MS <= cutoff) found = bar;
    else break;
  }
  return found && finitePositive(found.price) ? found.price : null;
}

/** The launch print, when the hourly bars start at the listing. */
export function launchFromHourly(
  hourly: readonly ChartPoint[],
  listedMs: number,
): number | null {
  const first = hourly[0];
  if (!first || Math.abs(first.t - listedMs) > 2 * HOUR_MS) return null;
  const price = launchPrintPrice(first, listedMs);
  return finitePositive(price) ? price : null;
}

export interface HeaderChange {
  pct: number | null;
  label: "24h" | "since launch";
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The market data gives a 24h change against its own snapshot price. That
 * fixes the price 24 hours ago; the change is then the live price against it,
 * so the % moves with the tape instead of waiting for the next snapshot.
 */
function changeAgainstSnapshot(
  livePrice: number | null | undefined,
  snapshotPrice: number | null | undefined,
  snapshotChangePct: number | null | undefined,
): number | null {
  if (!finitePositive(snapshotPrice) || typeof snapshotChangePct !== "number") return null;
  if (!Number.isFinite(snapshotChangePct) || snapshotChangePct <= -100) return null;
  const before = snapshotPrice / (1 + snapshotChangePct / 100);
  const now = finitePositive(livePrice) ? livePrice : snapshotPrice;
  return ((now - before) / before) * 100;
}

export function headerChange(input: {
  asset: Pick<Asset, "kind" | "priceUsd" | "changePct"> & {listedAt?: string | null};
  livePrice: number | null | undefined;
  /** The launch print, when the chart has it in view. */
  launchPrice?: number | null;
  /** Hourly bars, oldest first: the 24h reference when they reach back far enough. */
  hourly?: readonly ChartPoint[] | null;
  now?: number;
}): HeaderChange {
  const now = input.now ?? Date.now();
  const listed = input.asset.listedAt ? Date.parse(input.asset.listedAt) : NaN;
  const young =
    input.asset.kind === "token" && Number.isFinite(listed) && now - listed < DAY_MS && now >= listed;

  const hourly = input.hourly ?? [];
  const change = (from: number) =>
    finitePositive(input.livePrice) ? ((input.livePrice - from) / from) * 100 : null;

  if (young) {
    // The launch print from the hourly bars or the chart in view. Otherwise
    // the market's 24h change, which for a token this young spans its life.
    const launch = launchFromHourly(hourly, listed) ?? input.launchPrice;
    if (finitePositive(launch) && finitePositive(input.livePrice)) {
      return {pct: change(launch), label: "since launch"};
    }
    return {
      pct: changeAgainstSnapshot(input.livePrice, input.asset.priceUsd, input.asset.changePct),
      label: "since launch",
    };
  }

  const dayAgo = priceDayAgo(hourly, now);
  if (dayAgo != null && finitePositive(input.livePrice)) {
    return {pct: change(dayAgo), label: "24h"};
  }
  return {
    pct: changeAgainstSnapshot(input.livePrice, input.asset.priceUsd, input.asset.changePct),
    label: "24h",
  };
}

/** Change from the first bar in view to `price`, for the hover. */
export function changeFromViewStart(
  price: number | null | undefined,
  viewStart: number | null | undefined,
): number | null {
  if (!finitePositive(price) || !finitePositive(viewStart)) return null;
  return ((price - viewStart) / viewStart) * 100;
}

/**
 * The price at the top of a token page.
 *
 * The chain is the truth. The chart's last point already carries the newest
 * on-chain trade in the pool it charts (the tape is merged into it), so the
 * header reads the same number the line ends on and the trades list starts
 * with. A provider price only fills in when neither has anything.
 *
 * It used to prefer a shared "live" price that the market list also wrote
 * to, and the list could hold a stored price weeks old stamped as fresh: a
 * token whose pool last traded at $0.0000026 showed $0.000056 in the header.
 */
export function tokenHeaderPrice(input: {
  /** The chart as drawn: candles with the trade tape merged in, oldest first. */
  chartPoints: readonly ChartPoint[];
  /** The trades list, newest first. */
  trades: readonly Pick<Trade, "priceUsd">[];
  /** The provider's figure, for a token with no on-chain price at all. */
  providerPrice: number | null | undefined;
}): number | null {
  const last = input.chartPoints[input.chartPoints.length - 1];
  if (last && finitePositive(last.price)) return last.price;
  const newest = input.trades.find((trade) => finitePositive(trade.priceUsd));
  if (newest) return newest.priceUsd;
  return finitePositive(input.providerPrice) ? input.providerPrice : null;
}
