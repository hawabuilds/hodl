/**
 * CoinGecko Pro credit meter.
 *
 * Monthly remaining is not on ordinary onchain responses. `/api/v3/key` is
 * the source of truth — polled on a timer, not on every candle, because that
 * endpoint costs a credit too.
 *
 * Call counts are this process only. They answer "what is burning credits
 * right now" across chart / tape / sweep, not a billing invoice.
 */

export type GeckoCaller = "chart" | "tape" | "sweep" | "image" | "spark" | "other";
export type GeckoHost = "pro" | "free";

const EMPTY: Record<GeckoCaller, number> = {
  chart: 0,
  spark: 0,
  tape: 0,
  sweep: 0,
  image: 0,
  other: 0,
};

const proCalls: Record<GeckoCaller, number> = {...EMPTY};
const freeCalls: Record<GeckoCaller, number> = {...EMPTY};

let monthlyCredit: number | null = null;
let remainingCredit: number | null = null;
let lastKeyCheckAt = 0;
let warnedAtOrBelow20 = false;

export const KEY_POLL_MS = 10 * 60_000;
export const CREDIT_WARN_RATIO = 0.2;

export function shouldFallbackToFree(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export function creditRatio(
  remaining: number,
  monthly: number,
): number {
  if (!(monthly > 0)) return 1;
  return remaining / monthly;
}

export function shouldWarnCredits(remaining: number, monthly: number): boolean {
  return monthly > 0 && creditRatio(remaining, monthly) <= CREDIT_WARN_RATIO;
}

export function recordGeckoCall(caller: GeckoCaller, host: GeckoHost): void {
  if (host === "pro") proCalls[caller] += 1;
  else freeCalls[caller] += 1;
}

export function applyKeyUsage(body: {
  monthly_call_credit?: number;
  current_remaining_monthly_calls?: number;
}): {remaining: number | null; monthly: number | null; warned: boolean} {
  if (typeof body.monthly_call_credit === "number") {
    monthlyCredit = body.monthly_call_credit;
  }
  if (typeof body.current_remaining_monthly_calls === "number") {
    remainingCredit = body.current_remaining_monthly_calls;
  }
  let warned = false;
  if (
    monthlyCredit != null &&
    remainingCredit != null &&
    shouldWarnCredits(remainingCredit, monthlyCredit)
  ) {
    if (!warnedAtOrBelow20) {
      console.warn("coingecko credits at or below 20%", {
        remaining: remainingCredit,
        monthly: monthlyCredit,
        ratio: creditRatio(remainingCredit, monthlyCredit),
      });
      warnedAtOrBelow20 = true;
    }
    warned = true;
  } else if (
    monthlyCredit != null &&
    remainingCredit != null &&
    creditRatio(remainingCredit, monthlyCredit) > CREDIT_WARN_RATIO
  ) {
    warnedAtOrBelow20 = false;
  }
  return {remaining: remainingCredit, monthly: monthlyCredit, warned};
}

export function geckoUsageSnapshot() {
  return {
    pro: {...proCalls},
    free: {...freeCalls},
    remaining: remainingCredit,
    monthly: monthlyCredit,
    warned20: warnedAtOrBelow20,
  };
}

export function geckoCreditLogFields() {
  return {
    remaining: remainingCredit,
    monthly: monthlyCredit,
    pro: {...proCalls},
  };
}

export function shouldPollKey(now = Date.now()): boolean {
  return now - lastKeyCheckAt >= KEY_POLL_MS;
}

export function markKeyPolled(now = Date.now()): void {
  lastKeyCheckAt = now;
}

/** Test helper — not used in production paths. */
export function resetGeckoCreditsForTests(): void {
  for (const caller of Object.keys(EMPTY) as GeckoCaller[]) {
    proCalls[caller] = 0;
    freeCalls[caller] = 0;
  }
  monthlyCredit = null;
  remainingCredit = null;
  lastKeyCheckAt = 0;
  warnedAtOrBelow20 = false;
}
