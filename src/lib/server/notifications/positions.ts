import {db, hasDatabase} from "@/lib/server/db";
import type {Holding} from "@/lib/types";

/** Cache of balances we already fetched for the portfolio UI — notify path reads this, not RPC. */
export async function snapshotPositions(userId: string, holdings: Holding[]): Promise<void> {
  if (!hasDatabase) return;
  const now = new Date().toISOString();
  const rows = holdings.map((row) => ({
    user_id: userId,
    kind: row.kind,
    asset_id: row.assetId.toLowerCase(),
    symbol: row.symbol,
    amount: row.amount,
    value_usd: row.valueUsd,
    cost_usd: row.costUsd,
    updated_at: now,
  }));
  if (rows.length) {
    await db().from("user_positions").upsert(rows, {onConflict: "user_id,kind,asset_id"});
  }
  await db()
    .from("user_positions")
    .delete()
    .eq("user_id", userId)
    .lt("updated_at", now);
}

export async function holdersOf(
  kind: "token" | "rwa",
  assetIds: string[],
): Promise<Array<{userId: string; kind: "token" | "rwa"; assetId: string; symbol: string | null; valueUsd: number; costUsd: number | null}>> {
  if (!hasDatabase || assetIds.length === 0) return [];
  const ids = [...new Set(assetIds.map((id) => id.toLowerCase()))];
  const {data} = await db()
    .from("user_positions")
    .select("user_id, kind, asset_id, symbol, value_usd, cost_usd")
    .eq("kind", kind)
    .in("asset_id", ids)
    .gt("amount", 0);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    kind: row.kind === "rwa" ? "rwa" : "token",
    assetId: String(row.asset_id),
    symbol: row.symbol ?? null,
    valueUsd: Number(row.value_usd) || 0,
    costUsd: row.cost_usd != null ? Number(row.cost_usd) : null,
  }));
}
