import {normalizeAddress} from "@/lib/address";
import {encodeSpark} from "@/lib/spark";
import type {TokenAsset} from "@/lib/types";
import {waitUntil} from "@vercel/functions";
import {addToSetShared, claimShared, readFieldsShared, SHARED_CACHE} from "./shared";

/**
 * Mini charts for token rows, read from what the background builder stored
 * (see sparkBuilder.ts). A list build makes one Redis call for its whole page
 * and never waits on a price provider. A row's % is replaced by the line's own
 * change, so the two always agree.
 */

/** The compact form lists carry: shape 0–999, the line's % and its window. */
export interface SparkView {
  v: number[];
  /** Percent from the line's first point to its last. */
  p: number;
  /** "launch" for a token under 24h (the line starts at launch), else "24h". */
  w: "launch" | "24h";
}

export const SPARK_VIEW_KEY = "sparks:view:v1";
/** Rows that had no stored line, for the builder's next pass. */
export const SPARK_WANTED_KEY = "sparks:wanted:v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_MS = 30_000;

const local = new Map<string, {at: number; view: SparkView | null}>();

function originMs(token: TokenAsset): number {
  const at = Date.parse(token.listedAt ?? token.createdAt);
  return Number.isFinite(at) ? at : 0;
}

async function viewsFor(addresses: string[]): Promise<Map<string, SparkView>> {
  const now = Date.now();
  const out = new Map<string, SparkView>();
  const missing: string[] = [];
  for (const address of addresses) {
    const held = local.get(address);
    if (held && now - held.at < LOCAL_MS) {
      if (held.view) out.set(address, held.view);
    } else {
      missing.push(address);
    }
  }
  if (missing.length > 0 && SHARED_CACHE) {
    const found = await readFieldsShared<SparkView>(SPARK_VIEW_KEY, missing).catch(() => new Map<string, SparkView>());
    for (const address of missing) {
      const view = found.get(address) ?? null;
      local.set(address, {at: now, view});
      if (view) out.set(address, view);
    }
  }
  return out;
}

/** Gives each token its stored line and the % that line shows. */
export async function attachSparks<T extends TokenAsset>(tokens: T[]): Promise<T[]> {
  if (tokens.length === 0) return tokens;
  const addresses = tokens.map((token) => normalizeAddress(token.address));
  const views = await viewsFor(addresses);
  const now = Date.now();
  const wanted: string[] = [];
  const out = tokens.map((token, i) => {
    const view = views.get(addresses[i]);
    if (view && view.v.length > 1) {
      return {...token, series: view.v, changePct: view.p, changeWindow: view.w};
    }
    const young = now - originMs(token) < DAY_MS;
    // Brand new and never traded: a level line at its price. Nothing to fetch.
    if (young && !(token.volume24hUsd && token.volume24hUsd > 0) && token.priceUsd) {
      return {...token, series: encodeSpark([token.priceUsd, token.priceUsd]), changePct: 0, changeWindow: "launch" as const};
    }
    // Not built yet: no line rather than a guessed one; the builder picks it up.
    wanted.push(addresses[i]);
    return {...token, series: [], changeWindow: young ? ("launch" as const) : ("24h" as const)};
  });
  if (wanted.length > 0 && SHARED_CACHE) {
    void addToSetShared(SPARK_WANTED_KEY, wanted, 60 * 60).catch(() => {});
    void kickYoung(tokens.filter((token, i) => wanted.includes(addresses[i]) && now - originMs(token) < DAY_MS));
  }
  return out;
}

/**
 * A brand-new token that has already traded gets its line within seconds
 * rather than at the next cron pass: one small build for just those tokens,
 * behind the response, one at a time across all servers.
 */
async function kickYoung(young: TokenAsset[]): Promise<void> {
  if (young.length === 0) return;
  try {
    if (!(await claimShared("sparks:kick", 20_000))) return;
    const {buildSparks} = await import("./sparkBuilder");
    const work = buildSparks({budgetMs: 15_000, only: young.slice(0, 20).map((token) => token.address)});
    try {
      waitUntil(work.catch(() => {}));
    } catch {
      // Not on Vercel: it simply runs on.
    }
    await work;
  } catch {
    // The cron pass still picks them up.
  }
}
