import {db, hasDatabase} from "@/lib/server/db";

export type WatchRow = {
  userId: string;
  kind: "token" | "rwa";
  assetId: string;
  addPrice: number | null;
  addedAt: string;
};

export async function listWatchlist(userId: string): Promise<WatchRow[]> {
  if (!hasDatabase) return [];
  const {data} = await db()
    .from("watchlist")
    .select("user_id, kind, asset_id, add_price, added_at")
    .eq("user_id", userId)
    .order("added_at", {ascending: false});
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    kind: row.kind === "rwa" ? "rwa" : "token",
    assetId: String(row.asset_id),
    addPrice: row.add_price != null ? Number(row.add_price) : null,
    addedAt: String(row.added_at),
  }));
}

export async function setWatchlistItem(input: {
  userId: string;
  kind: "token" | "rwa";
  assetId: string;
  watching: boolean;
  addPrice: number | null;
}): Promise<boolean> {
  if (!hasDatabase) return false;
  const assetId = input.assetId.toLowerCase();
  if (!input.watching) {
    await db()
      .from("watchlist")
      .delete()
      .eq("user_id", input.userId)
      .eq("kind", input.kind)
      .eq("asset_id", assetId);
    await db()
      .from("position_milestones")
      .delete()
      .eq("user_id", input.userId)
      .eq("kind", input.kind)
      .eq("asset_id", assetId)
      .eq("source", "watchlist");
    return true;
  }
  const {data: existing} = await db()
    .from("watchlist")
    .select("asset_id")
    .eq("user_id", input.userId)
    .eq("kind", input.kind)
    .eq("asset_id", assetId)
    .maybeSingle();
  if (existing) return true;
  const {error} = await db().from("watchlist").insert({
    user_id: input.userId,
    kind: input.kind,
    asset_id: assetId,
    add_price: input.addPrice,
  });
  return !error;
}

export async function watchersOf(kind: "token" | "rwa", assetIds: string[]): Promise<WatchRow[]> {
  if (!hasDatabase || assetIds.length === 0) return [];
  const ids = [...new Set(assetIds.map((id) => id.toLowerCase()))];
  const {data} = await db()
    .from("watchlist")
    .select("user_id, kind, asset_id, add_price, added_at")
    .eq("kind", kind)
    .in("asset_id", ids);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    kind: row.kind === "rwa" ? "rwa" : "token",
    assetId: String(row.asset_id),
    addPrice: row.add_price != null ? Number(row.add_price) : null,
    addedAt: String(row.added_at),
  }));
}
