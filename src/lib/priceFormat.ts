/**
 * Prices for the chart page: the header, the hover and the price axis.
 *
 * Adapted from Trador's `src/lib/priceFormat.ts`. A launchpad token can be
 * worth $0.0000025 and the stock it is paired with $580, and writing out every
 * zero of the first reads as a broken number. Below $0.0001 the zeros are
 * counted instead, the way DexScreener writes them:
 *
 *   0.000002583  →  $0.0₅2583   (five zeros, then four significant digits)
 *
 * Trador's copy counts one zero short and keeps three digits ($0.0₄258 for the
 * same price); this one counts every zero after the decimal point.
 */

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function subscript(value: number): string {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPTS[Number(digit)])
    .join("");
}

/**
 * Thousands grouped by hand: `toLocaleString` can differ between the server
 * and the browser, and React throws the server HTML away over the mismatch.
 */
function groupThousands(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Zeros straight after the decimal point: 0.0025 has two, 0.0001 three. */
function zerosAfterPoint(abs: number): number {
  return Math.max(0, -Math.floor(Math.log10(abs)) - 1);
}

/** The first four significant digits of a price under $0.0001, as "$0.0₅2583". */
function subscriptDigits(abs: number): string {
  let zeros = zerosAfterPoint(abs);
  let digits = Math.round(abs * 10 ** (zeros + 4));
  // 0.0000099996 rounds up to 10000: one zero fewer, and "1000".
  if (digits >= 10_000) {
    zeros -= 1;
    digits = Math.round(digits / 10);
  }
  return `$0.0${subscript(zeros)}${String(digits).padStart(4, "0")}`;
}

/**
 * A price someone is about to trade on: full precision above a cent, four
 * significant digits below it, zeros counted below $0.0001. Unknown is "—",
 * never "$0.00".
 */
export function formatSubscriptUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_000) return `$${groupThousands(value.toFixed(2))}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  const zeros = zerosAfterPoint(value);
  if (zeros <= 3) return `$${value.toFixed(zeros + 4)}`;
  return subscriptDigits(value);
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * A tick on the price axis. The same shapes as the header, without trailing
 * zeros — the axis steps in round numbers, and "$0.2500" is noise.
 *
 * `minMove` is the axis's step. Anything within half a step of zero is zero:
 * floating-point noise on the bottom tick is what printed
 * "$0.000000000000000028".
 */
export function formatAxisUsd(value: number, minMove = 0): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) <= minMove / 2 || value === 0) return "$0";
  if (value < 0) return `-${formatAxisUsd(-value, minMove)}`;
  if (value >= 1_000) return `$${groupThousands(value.toFixed(2))}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${trimZeros(value.toFixed(4))}`;
  const zeros = zerosAfterPoint(value);
  if (zeros <= 3) return `$${trimZeros(value.toFixed(zeros + 4))}`;
  const full = subscriptDigits(value);
  return full.replace(/0+$/, "");
}

/**
 * The axis step for a series: a thousandth of its smallest price, so a token
 * at $0.0000025 gets ticks as fine as its moves instead of the default $0.01 —
 * which left it one tick, at zero.
 */
export function priceMinMove(prices: readonly number[]): number {
  let smallest = Infinity;
  for (const price of prices) {
    if (Number.isFinite(price) && price > 0 && price < smallest) smallest = price;
  }
  if (!Number.isFinite(smallest)) return 0.01;
  const step = 10 ** (Math.floor(Math.log10(smallest)) - 3);
  return Math.min(0.01, step);
}
