import {normalizeAddress} from "@/lib/address";
import {encodeSpark, sparkChangePct} from "@/lib/spark";
import type {TokenAsset} from "@/lib/types";
import {readLastGood} from "./cache";
import {backgroundCandles, trades} from "./geckoterminal";
import {isGeckoCooling} from "./geckoFetch";
import {poolFor} from "./market";
import {
  countShared,
  deleteFieldsShared,
  readAllFieldsShared,
  takeFromSetShared,
  writeFieldsShared,
} from "./shared";
import {SPARK_VIEW_KEY, SPARK_WANTED_KEY, type SparkView} from "./sparks";
import {getTokenRows, statsFor} from "./universeStore";

/**
 * Builds the token rows' mini charts in the background, so lists only read.
 *
 *   never traded       a level line at its price (no provider call)
 *   < 30 trades        one point per trade, from the first
 *   under 6h old       1-minute points, launch to now
 *   6h to 24h old      15-minute points, launch to now
 *   over 24h old       the last 24h, 15-minute points (96)
 *
 * Real history only. A token over 24h is backfilled once from GeckoTerminal's
 * 15-minute candles and then extended every 15 minutes from the price our own
 * price job already stores — no provider call. A young token is rebuilt from
 * its trades only after its price has moved, at most every few minutes. Every
 * GeckoTerminal call counts against a daily cap, so a busy day cannot eat the
 * month's plan; past the cap, lines keep their last build.
 */

const STORE_KEY = "sparks:store:v1";
const STORE_TTL_S = 3 * 24 * 60 * 60;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP_15M = 15 * MIN;
const DAY_POINTS = 96;
const FEW_TRADES = 30;
/** GeckoTerminal calls this builder may make per UTC day (the plan is 500k a month for everything). */
export const SPARK_DAILY_GECKO_CAP = 3_000;
/** Tokens the builder looks at per pass. */
const MAX_TOKENS = 400;
/** A token that gave nothing to draw is asked again after this long. */
const RETRY_EMPTY_YOUNG_MS = 15 * MIN;
const RETRY_EMPTY_OLD_MS = HOUR;

/** Visible lists whose tokens get lines first. */
const LIST_KEYS = [
  "page:tokens-new:limit=50",
  "page:market:sort=trending",
  "page:market:sort=volume",
  "page:tokens-table:dir=desc&sort=vol&tab=trending",
  "page:tokens-table:dir=desc&sort=age&tab=new",
];

interface StoredSpark {
  /** Real prices, oldest first. */
  pts: number[];
  /** "none": tried and got nothing to draw — not retried until RETRY_EMPTY_MS. */
  kind: "flat" | "trades" | "1m" | "15m" | "none";
  window: "launch" | "24h";
  /** Time of the last point (ms). */
  lastAt: number;
  builtAt: number;
}

function round(price: number): number {
  return Number(price.toPrecision(6));
}

/** Last value at or before each step from `from` to `to`, filled forward. */
export function onGrid(points: {t: number; price: number}[], from: number, to: number, step: number): number[] {
  const sorted = points.filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [];
  const out: number[] = [];
  let i = 0;
  let current = sorted[0].price;
  for (let t = from; t <= to + 1; t += step) {
    while (i < sorted.length && sorted[i].t <= t) current = sorted[i++].price;
    out.push(round(current));
  }
  return out;
}

function due(ageMs: number, builtAt: number, now: number): boolean {
  const every = ageMs < HOUR ? 4 * MIN : ageMs < 6 * HOUR ? 10 * MIN : 30 * MIN;
  return now - builtAt >= every;
}

function view(spark: StoredSpark): SparkView {
  return {v: encodeSpark(spark.pts), p: Number(sparkChangePct(spark.pts).toFixed(2)), w: spark.window};
}

async function geckoAllowance(day: string): Promise<number> {
  const used = (await countShared(`sparks:gecko:${day}`, 0, 2 * 24 * 60 * 60).catch(() => null)) ?? 0;
  return Math.max(0, SPARK_DAILY_GECKO_CAP - used);
}

export async function buildSparks(opts: {budgetMs?: number; only?: string[]} = {}): Promise<{
  looked: number;
  built: number;
  extended: number;
  geckoCalls: number;
  geckoLeft: number;
}> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 90_000);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10).replaceAll("-", "");

  // Who needs a line: what the lists show, then rows that asked for one.
  const listed: string[] = [];
  for (const key of opts.only ? [] : LIST_KEYS) {
    const copy = await readLastGood<{tokens?: TokenAsset[]; rows?: {asset: TokenAsset}[]}>(key).catch(() => null);
    for (const token of [...(copy?.tokens ?? []), ...(copy?.rows ?? []).map((row) => row.asset)]) {
      if (token?.kind === "token") listed.push(normalizeAddress(token.address));
    }
  }
  const wanted = opts.only
    ? opts.only.map(normalizeAddress)
    : (await takeFromSetShared(SPARK_WANTED_KEY, 200).catch(() => [])).map(normalizeAddress);
  const addresses = [...new Set([...listed, ...wanted])].slice(0, MAX_TOKENS);
  if (addresses.length === 0) return {looked: 0, built: 0, extended: 0, geckoCalls: 0, geckoLeft: 0};

  const [rows, stats, stored] = await Promise.all([
    getTokenRows(addresses),
    statsFor(addresses),
    readAllFieldsShared<StoredSpark>(STORE_KEY),
  ]);
  const origin = new Map(
    rows.map((row) => [normalizeAddress(row.address), Date.parse(row.listed_at ?? row.created_at)] as const),
  );

  let geckoLeft = await geckoAllowance(day);
  let geckoCalls = 0;
  const spend = () => {
    geckoCalls += 1;
    geckoLeft -= 1;
  };
  // Rate-limited (we share the plan with the live site): stop asking this pass.
  const canAsk = () => geckoLeft > 0 && !isGeckoCooling("pro");
  const empty = (window: StoredSpark["window"]): StoredSpark => ({pts: [], kind: "none", window, lastAt: now, builtAt: now});

  // Missing lines first, then the youngest (their lines change fastest).
  const order = addresses
    .filter((address) => Number.isFinite(origin.get(address)))
    .sort((a, b) => {
      const missing = Number(stored.has(a)) - Number(stored.has(b));
      return missing || (origin.get(b) ?? 0) - (origin.get(a) ?? 0);
    });

  const changed = new Map<string, StoredSpark>();
  let built = 0;
  let extended = 0;

  for (const address of order) {
    if (Date.now() > deadline) break;
    const born = origin.get(address)!;
    const age = now - born;
    const stat = stats.get(address);
    const price = stat?.last_price != null && stat.last_price > 0 ? Number(stat.last_price) : null;
    const current = stored.get(address);

    // Tried recently and got nothing: leave it until the retry time.
    if (current?.kind === "none" && now - current.builtAt < (age < DAY ? RETRY_EMPTY_YOUNG_MS : RETRY_EMPTY_OLD_MS)) continue;

    try {
      if (age < DAY) {
        const traded = (stat?.vol_24h ?? 0) > 0 || Boolean(stat?.price_moved_at);
        if (!traded) {
          if (price && (!current || current.kind !== "flat" || current.pts[0] !== round(price))) {
            changed.set(address, {pts: [round(price), round(price)], kind: "flat", window: "launch", lastAt: now, builtAt: now});
          }
          continue;
        }
        const movedAt = stat?.price_moved_at ? Date.parse(stat.price_moved_at) : now;
        const stale =
          !current || current.kind === "flat" || current.kind === "none" || current.window !== "launch" || movedAt > current.builtAt;
        if (stale && (!current || current.kind === "none" || due(age, current.builtAt, now)) && canAsk()) {
          const pool = await poolFor("token", address);
          if (!pool) continue;
          spend();
          const fills = (await trades(pool.pool, pool.token, 300, true)).trades
            .map((trade) => ({t: Date.parse(trade.at), price: trade.priceUsd}))
            .filter((fill) => Number.isFinite(fill.t) && fill.price > 0)
            .sort((a, b) => a.t - b.t);
          const step = age < 6 * HOUR ? MIN : STEP_15M;
          const covered = fills.length > 0 && (fills.length < 300 || fills[0].t <= born + step);
          let pts: number[] = [];
          let kind: StoredSpark["kind"] = step === MIN ? "1m" : "15m";
          if (covered && fills.length < FEW_TRADES) {
            pts = fills.map((fill) => round(fill.price));
            if (pts.length === 1) pts = [pts[0], pts[0]];
            kind = "trades";
          } else if (covered) {
            pts = onGrid(fills, born, now, step);
          } else if (canAsk()) {
            spend();
            const bars = Math.min(400, Math.ceil(age / step) + 2);
            const loaded = await backgroundCandles(pool.pool, step === MIN ? "1m" : "15m", pool.token, bars);
            pts = onGrid(loaded.filter((p) => p.t >= born - step), born, now, step);
          }
          if (pts.length > 1) {
            changed.set(address, {pts, kind, window: "launch", lastAt: now, builtAt: now});
            built += 1;
          } else if (!isGeckoCooling("pro")) {
            changed.set(address, empty("launch"));
          }
          continue;
        }
        // Nothing new traded: carry a gridded line on to now at its last price.
        if (current && (current.kind === "1m" || current.kind === "15m")) {
          const step = current.kind === "1m" ? MIN : STEP_15M;
          const pts = [...current.pts];
          let lastAt = current.lastAt;
          while (lastAt + step <= now) {
            pts.push(price ? round(price) : pts[pts.length - 1]);
            lastAt += step;
          }
          if (lastAt !== current.lastAt) {
            changed.set(address, {...current, pts, lastAt});
            extended += 1;
          }
        }
        continue;
      }

      // Over 24h: backfill once from candles, then extend from our own price.
      // A line left alone more than 2h (off every list) is backfilled again
      // rather than filled forward across the gap.
      if (!current || current.kind !== "15m" || current.window !== "24h" || now - current.lastAt > 2 * HOUR) {
        if (!canAsk()) continue;
        const pool = await poolFor("token", address);
        if (!pool) continue;
        spend();
        const loaded = await backgroundCandles(pool.pool, "15m", pool.token, DAY_POINTS + 4);
        const from = now - DAY + STEP_15M;
        let pts = onGrid(loaded, from, now, STEP_15M);
        if (pts.length < 2 && price) pts = Array.from({length: DAY_POINTS}, () => round(price));
        if (pts.length > 1) {
          changed.set(address, {pts: pts.slice(-DAY_POINTS), kind: "15m", window: "24h", lastAt: from + (pts.length - 1) * STEP_15M, builtAt: now});
          built += 1;
        } else if (!isGeckoCooling("pro")) {
          changed.set(address, empty("24h"));
        }
        continue;
      }
      const pts = [...current.pts];
      let lastAt = current.lastAt;
      while (lastAt + STEP_15M <= now) {
        pts.push(price ? round(price) : pts[pts.length - 1]);
        lastAt += STEP_15M;
      }
      if (lastAt !== current.lastAt) {
        changed.set(address, {...current, pts: pts.slice(-DAY_POINTS), lastAt});
        extended += 1;
      }
    } catch (error) {
      console.warn("spark build failed", address, error instanceof Error ? error.message : error);
    }
  }

  if (geckoCalls > 0) await countShared(`sparks:gecko:${day}`, geckoCalls, 2 * 24 * 60 * 60).catch(() => null);
  if (changed.size > 0) {
    const entries = [...changed.entries()];
    await writeFieldsShared(STORE_KEY, entries, STORE_TTL_S);
    const drawable = entries.filter(([, spark]) => spark.pts.length > 1);
    await writeFieldsShared(SPARK_VIEW_KEY, drawable.map(([address, spark]) => [address, view(spark)]), STORE_TTL_S);
  }
  // Lines nobody has looked at for two days are dropped.
  const old = [...stored.entries()].filter(([address, spark]) => !changed.has(address) && now - Math.max(spark.lastAt, spark.builtAt) > 2 * DAY);
  if (old.length > 0) {
    const fields = old.map(([address]) => address);
    await Promise.all([deleteFieldsShared(STORE_KEY, fields), deleteFieldsShared(SPARK_VIEW_KEY, fields)]);
  }

  return {looked: order.length, built, extended, geckoCalls, geckoLeft};
}
