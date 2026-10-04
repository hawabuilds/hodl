import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {callerId} from "@/lib/server/auth";
import {db, hasDatabase} from "@/lib/server/db";
import {applyCostBasis, tradesFor} from "@/lib/server/live/costBasis";
import {holdingsFor, nativeOnly} from "@/lib/server/live/holdings";
import {maybeWritePortfolioSnapshot} from "@/lib/server/live/portfolioSnapshots";
import {fetchEthPrice} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

function walletsFrom(request: NextRequest): string[] {
  const params = request.nextUrl.searchParams;
  const many = params.get("wallets");
  const one = params.get("wallet");
  const raw = many ? many.split(",") : one ? [one] : [];
  return raw.filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()));
}

function walletsLower(wallets: string[]): string[] {
  return [...new Set(wallets.map((wallet) => wallet.trim().toLowerCase()))];
}

/** What the signed-in wallets hold. Accepts one `wallet` or many `wallets`. */
export async function GET(request: NextRequest) {
  const wallets = walletsFrom(request);
  if (wallets.length === 0) {
    return badRequest("A wallet address is required.");
  }

  const phase = request.nextUrl.searchParams.get("phase");
  if (phase === "native") {
    return json(await nativeOnly(wallets));
  }

  const known = (request.nextUrl.searchParams.get("known") ?? "")
    .split(",")
    .filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()));

  // The ETH price loads beside the balances, not after them.
  const ethRead = fetchEthPrice();
  const [read, trades] = await Promise.all([
    holdingsFor(wallets, known),
    tradesFor(walletsLower(wallets)).catch((error) => {
      console.error("trade history read failed", error);
      return [];
    }),
  ]);
  // Cost basis and total P&L from the fills saved for these wallets.
  const basis = applyCostBasis(read.holdings, trades);
  const book = {...read, holdings: basis.holdings, pnl: basis.pnl};
  // A holding still waiting on its price would count as zero: no snapshot is
  // taken from a book like that, or the chart drops to the ETH balance.
  const pricesMissing = book.holdings.some((row) => row.priceState === "pending");
  const positionsUsd = book.holdings.reduce((sum, row) => sum + row.valueUsd, 0);
  const eth = await ethRead;
  const ethUsd = book.ethBalance * (eth.data > 0 ? eth.data : 0);
  // A missing ETH print would understate a native-only book; skip the row.
  const priced = book.ethBalance <= 0 || eth.data > 0;
  // USDG is cash at $1: it counts toward the total like ETH does.
  const usdgUsd = book.usdgBalance;

  if (!book.degraded && priced && !pricesMissing) {
    await maybeWritePortfolioSnapshot({
      wallets,
      totalUsd: positionsUsd + ethUsd + usdgUsd,
      positionsUsd,
      ethUsd,
      degraded: book.degraded,
    });
  }

  const userId = await callerId(request);
  if (userId && !book.degraded && !pricesMissing) {
    const {snapshotPositions} = await import("@/lib/server/notifications/positions");
    const {resetHoldingsMilestones} = await import("@/lib/server/notifications/milestonesPass");
    void (async () => {
      const previous = hasDatabase
        ? await db()
            .from("user_positions")
            .select("kind, asset_id")
            .eq("user_id", userId)
            .gt("amount", 0)
        : {data: [] as {kind: string; asset_id: string}[]};
      const before = new Set(
        (previous.data ?? []).map((row) => `${row.kind}:${String(row.asset_id).toLowerCase()}`),
      );
      await snapshotPositions(userId, book.holdings);
      for (const key of before) {
        const [kind, assetId] = key.split(":");
        if (!kind || !assetId) continue;
        const still = book.holdings.some(
          (row) => row.kind === kind && row.assetId.toLowerCase() === assetId,
        );
        if (!still && (kind === "token" || kind === "rwa")) {
          await resetHoldingsMilestones(userId, kind, assetId);
        }
      }
    })().catch((error) => console.error("position snapshot failed", error));
  }

  return json(book);
}
