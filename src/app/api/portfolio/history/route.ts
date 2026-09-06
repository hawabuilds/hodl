import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {
  loadPortfolioSnapshots,
  parsePortfolioRange,
  snapshotWallets,
} from "@/lib/server/live/portfolioSnapshots";

export const dynamic = "force-dynamic";

/** Equity history for the signed-in wallets. Real snapshots only. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const wallets = snapshotWallets(
    (params.get("wallets") ?? params.get("wallet") ?? "").split(","),
  );
  if (wallets.length === 0) {
    return badRequest("A wallet address is required.");
  }

  const range = parsePortfolioRange(params.get("range"));
  if (!range) return badRequest("Range must be 1H, 1D, 1W, 1M, 1Y, or ALL.");

  const snapshots = await loadPortfolioSnapshots(wallets, range);
  return json({
    range,
    snapshots: snapshots.map((row) => ({
      t: row.capturedAt,
      price: row.totalUsd,
    })),
  });
}
