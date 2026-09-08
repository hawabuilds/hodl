import {assetPath} from "@/lib/routes";
import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {
  consumeThrough,
  highestMilestone,
  multipleRatio,
  type Milestone,
} from "@/lib/notifications/milestones";
import {db, hasDatabase} from "@/lib/server/db";
import {enqueueNotification} from "./dispatch";
import {holdersOf} from "./positions";
import {prefsFor} from "./prefs";
import {watchersOf} from "./watchlist";

export type PricedPrint = {
  address: string;
  last_price: number | null;
  last_mcap: number | null;
  liquidity_usd: number | null;
};

async function firedMilestones(
  userId: string,
  kind: "token" | "rwa",
  assetId: string,
  source: "holdings" | "watchlist",
): Promise<number[]> {
  if (!hasDatabase) return [];
  const {data} = await db()
    .from("position_milestones")
    .select("milestone")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("asset_id", assetId)
    .eq("source", source);
  return (data ?? []).map((row) => Number(row.milestone));
}

async function markFired(
  userId: string,
  kind: "token" | "rwa",
  assetId: string,
  source: "holdings" | "watchlist",
  steps: Milestone[],
): Promise<void> {
  if (!steps.length || !hasDatabase) return;
  await db().from("position_milestones").upsert(
    steps.map((milestone) => ({
      user_id: userId,
      kind,
      asset_id: assetId,
      source,
      milestone,
    })),
    {onConflict: "user_id,kind,asset_id,source,milestone"},
  );
}

async function notifyMultiple(input: {
  userId: string;
  source: "holdings" | "watchlist";
  symbol: string;
  kind: "token" | "rwa";
  assetId: string;
  milestone: Milestone;
  enabled: readonly number[];
}): Promise<void> {
  const consume = consumeThrough(input.milestone, input.enabled);
  await markFired(input.userId, input.kind, input.assetId, input.source, consume);
  const copy =
    input.source === "holdings"
      ? `${input.symbol} is ${input.milestone}x on your position`
      : `${input.symbol} is ${input.milestone}x since you watchlisted it`;
  await enqueueNotification({
    userId: input.userId,
    channel: input.source,
    kind: "multiple",
    title: copy,
    body: copy,
    url: assetPath(input.kind, input.assetId),
    dedupeKey: `${input.source}:${input.kind}:${input.assetId}:${input.milestone}`,
  });
}

/**
 * Uses prices already written this cron pass. No extra RPC.
 * Holdings multiples require cost_usd (real fills). Missing basis → skip, never fake.
 */
export async function runMilestonePass(prints: PricedPrint[]): Promise<{watchlist: number; holdings: number}> {
  const priced = prints.filter(
    (row) =>
      row.last_price != null &&
      row.last_price > 0 &&
      (row.liquidity_usd == null || row.liquidity_usd >= 1000 || row.liquidity_usd >= MIN_LIQUIDITY_USD),
  );
  if (!priced.length) return {watchlist: 0, holdings: 0};

  const byAddress = new Map(priced.map((row) => [row.address.toLowerCase(), row]));
  const addresses = [...byAddress.keys()];
  const watchers = await watchersOf("token", addresses);
  const holders = await holdersOf("token", addresses);
  const holdingKeys = new Set(holders.map((row) => `${row.userId}:${row.assetId}`));

  let watchlist = 0;
  let holdings = 0;

  for (const holder of holders) {
    const print = byAddress.get(holder.assetId);
    if (!print?.last_price) continue;
    if (holder.costUsd == null || !(holder.costUsd > 0)) continue;
    const prefs = await prefsFor(holder.userId);
    if (holder.valueUsd < prefs.minPositionUsd) continue;
    if ((print.liquidity_usd ?? 0) < 1000 && print.liquidity_usd != null) continue;
    if (!prefs.holdingsOn || prefs.muted) continue;
    const entry = holder.costUsd; // total cost; ratio vs value
    const ratio = multipleRatio(holder.valueUsd, entry);
    if (ratio == null) continue;
    const fired = await firedMilestones(holder.userId, "token", holder.assetId, "holdings");
    const hit = highestMilestone(ratio, prefs.holdingsMultiples, fired);
    if (!hit) continue;
    await notifyMultiple({
      userId: holder.userId,
      source: "holdings",
      symbol: holder.symbol ?? "Token",
      kind: "token",
      assetId: holder.assetId,
      milestone: hit,
      enabled: prefs.holdingsMultiples,
    });
    holdings += 1;
  }

  for (const watcher of watchers) {
    if (holdingKeys.has(`${watcher.userId}:${watcher.assetId}`)) continue;
    const print = byAddress.get(watcher.assetId);
    if (!print?.last_price || watcher.addPrice == null || !(watcher.addPrice > 0)) continue;
    if ((print.liquidity_usd ?? Infinity) < 1000) continue;
    const prefs = await prefsFor(watcher.userId);
    if (!prefs.watchlistOn || prefs.muted) continue;
    const ratio = multipleRatio(print.last_price, watcher.addPrice);
    if (ratio == null) continue;
    const fired = await firedMilestones(watcher.userId, watcher.kind, watcher.assetId, "watchlist");
    const hit = highestMilestone(ratio, prefs.watchlistMultiples, fired);
    if (!hit) continue;
    await notifyMultiple({
      userId: watcher.userId,
      source: "watchlist",
      symbol: watcher.assetId.slice(0, 6).toUpperCase(),
      kind: watcher.kind,
      assetId: watcher.assetId,
      milestone: hit,
      enabled: prefs.watchlistMultiples,
    });
    watchlist += 1;
  }

  return {watchlist, holdings};
}

export async function resetHoldingsMilestones(userId: string, kind: "token" | "rwa", assetId: string): Promise<void> {
  if (!hasDatabase) return;
  await db()
    .from("position_milestones")
    .delete()
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("asset_id", assetId.toLowerCase())
    .eq("source", "holdings");
}
