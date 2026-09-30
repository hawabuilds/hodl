/**
 * The price every surface agrees on, for one asset.
 *
 * Two things learn a token's price at different rates: the feed poll, every ten
 * seconds for the whole market, and the trade tape on an open chart page, every
 * two seconds for one token. They used to feed different renderings of the
 * market cap, which is why the feed and the chart page disagreed.
 *
 * This is the single place both of them write to and every surface reads from.
 * A price carries the moment it describes, and an older reading is refused —
 * the feed's ten-second snapshot cannot overwrite a fill that landed a moment
 * ago just by arriving after it, which is a race that otherwise happens on
 * every chart page several times a minute.
 *
 * Deliberately framework-free at the core, so the staleness rule can be tested
 * without rendering anything.
 */

export interface PriceReading {
  price: number;
  /** When this price was true, in epoch milliseconds. */
  at: number;
}

const readings = new Map<string, PriceReading>();
const listeners = new Set<() => void>();

/** Lower-cased so a checksummed address and its lower-case form agree. */
const keyFor = (id: string) => id.toLowerCase();

/**
 * Records a price, if it is newer than what is already known.
 *
 * Returns whether it was accepted, which is what the tests assert on.
 */
export function publishPrice(id: string, price: number, at: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(at)) return false;

  const key = keyFor(id);
  const held = readings.get(key);
  // Equal timestamps lose too: the held reading got here first, and swapping it
  // for another of the same age is churn without new information.
  if (held && at <= held.at) return false;

  readings.set(key, {price, at});
  for (const listener of listeners) listener();
  return true;
}

/**
 * Records many prices and notifies once.
 *
 * The feed carries several hundred assets and publishes all of them on every
 * poll. Notifying per asset would wake every subscribed row several hundred
 * times for one refresh; this wakes them once, and only if something changed.
 */
export function publishPrices(
  entries: {id: string; price: number; at: number}[],
): number {
  let accepted = 0;

  for (const entry of entries) {
    if (!Number.isFinite(entry.price) || entry.price <= 0) continue;
    if (!Number.isFinite(entry.at)) continue;

    const key = keyFor(entry.id);
    const held = readings.get(key);
    if (held && entry.at <= held.at) continue;

    readings.set(key, {price: entry.price, at: entry.at});
    accepted++;
  }

  if (accepted > 0) for (const listener of listeners) listener();
  return accepted;
}

/**
 * How old a feed price may be and still be offered as the live price.
 *
 * The feed carries two kinds of price: one a provider read for this payload,
 * and one lifted from the store because no provider covered the token. The
 * second can be weeks old. Stamped with the payload's time, as it used to be,
 * it beat every fill on the token's own tape, and the page header showed
 * Insulinu at a price its pool had left two weeks earlier. Past this age a
 * price is left to the feed row that carries it and kept out of the shared one.
 */
export const FEED_READING_MAX_AGE_MS = 15 * 60_000;

/**
 * The feed's prices as readings, each stamped with when it was actually read.
 *
 * `priceAt` is that time when the server knows it; otherwise the payload's
 * `asOf` stands in, which is right for a provider read and for stock quotes.
 */
export function feedReadings(
  assets: {id: string; priceUsd: number | null; priceAt?: string | null}[],
  asOf: number,
  now: number = Date.now(),
): {id: string; price: number; at: number}[] {
  const out: {id: string; price: number; at: number}[] = [];
  for (const asset of assets) {
    const price = asset.priceUsd;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const read = asset.priceAt ? Date.parse(asset.priceAt) : NaN;
    const at = Number.isFinite(read) ? Math.min(read, asOf) : asOf;
    if (now - at > FEED_READING_MAX_AGE_MS) continue;
    out.push({id: asset.id, price, at});
  }
  return out;
}

/** The newest known price for an asset, or null if nothing has published one. */
export function priceFor(id: string): number | null {
  return readings.get(keyFor(id))?.price ?? null;
}

/** The newest reading, timestamp included. */
export function readingFor(id: string): PriceReading | null {
  return readings.get(keyFor(id)) ?? null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. Never called by the app. */
export function resetPrices(): void {
  readings.clear();
  listeners.clear();
}
