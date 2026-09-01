/**
 * Deterministic pseudo-randomness.
 *
 * Every number in the seeded universe is derived from a string key rather than
 * `Math.random`, so a card, its chart and its trade list all agree, and a
 * refresh does not reshuffle the feed under someone's thumb.
 */
export function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and stable across Node and the browser. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length) % values.length];
}

export function between(next: () => number, min: number, max: number): number {
  return min + next() * (max - min);
}

/**
 * A synthetic address that is well-formed and stable for a given key.
 *
 * Real addresses arrive with the registry and the pool indexer; until then these
 * keep every copy-to-clipboard and explorer link in the UI exercisable.
 */
export function fakeAddress(seed: string): string {
  return `0x${hexDigits(seed, 40)}`;
}

function hexDigits(seed: string, count: number): string {
  let out = "";
  let h = hash(seed);
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out += "0123456789abcdef"[h & 15];
  }
  return out;
}

/** A well-formed 32-byte transaction hash, stable for a given key. */
export function fakeHash(seed: string): string {
  return `0x${hexDigits(seed, 64)}`;
}

/**
 * The clock the whole universe reads.
 *
 * Prices drift on a one-minute cadence so the feed feels live, while every
 * request inside the same minute sees identical numbers — otherwise a card and
 * the chart page it opens would disagree.
 */
export function marketTick(now: number = Date.now()): number {
  return Math.floor(now / 60_000);
}
