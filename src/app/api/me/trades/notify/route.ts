import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {recordHodlTrade} from "@/lib/server/hodlTrades";
import {notifyTradeFailed, notifyTradeFilled} from "@/lib/server/notifications/trades";

export const dynamic = "force-dynamic";
// Recording waits up to 15s for our node to see the receipt.
export const maxDuration = 30;

/**
 * Called after the client waits for a confirmed receipt, or after a submit
 * that never broadcast (nothing charged). Does not invent fills.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    side?: string;
    kind?: string;
    assetId?: string;
    ticker?: string;
    tokenAmount?: number;
    quoteAmount?: number;
    quoteSymbol?: string;
    txHash?: string;
    reason?: string;
  };

  const kind = body.kind === "rwa" ? "rwa" : body.kind === "token" ? "token" : null;
  const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().slice(0, 24) : "";
  if (!kind || !assetId || !ticker) return badRequest("Which trade?");

  if (body.status === "filled") {
    const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
    const tokenAmount = Number(body.tokenAmount);
    const quoteAmount = Number(body.quoteAmount);
    const quoteSymbol =
      typeof body.quoteSymbol === "string" ? body.quoteSymbol.trim().slice(0, 16) : "";
    if (!side || !(tokenAmount > 0) || !(quoteAmount > 0) || !quoteSymbol) {
      return badRequest("Fill amounts are required.");
    }
    await notifyTradeFilled({
      userId: caller.userId,
      side,
      kind,
      assetId,
      ticker,
      tokenAmount,
      quoteAmount,
      quoteSymbol,
    }).catch((error) => console.error("trade fill notify failed", error));
    // For the Following feed. Written only once the chain confirms it; the
    // amounts above are the ticket's claim and are not what gets stored.
    if (typeof body.txHash === "string") {
      await recordHodlTrade({
        userId: caller.userId,
        txHash: body.txHash,
        kind,
        assetId,
        symbol: ticker,
      })
        .then((result) => {
          if (!result.recorded) console.info("hodl trade not recorded:", result.reason);
        })
        .catch((error) => console.error("hodl trade record failed", error));
    }
    return json({ok: true});
  }

  if (body.status === "failed") {
    const reason =
      typeof body.reason === "string" ? body.reason.replace(/!+/g, "").trim().slice(0, 180) : "";
    if (!reason) return badRequest("A failure reason is required.");
    await notifyTradeFailed({
      userId: caller.userId,
      kind,
      assetId,
      ticker,
      reason,
    }).catch((error) => console.error("trade fail notify failed", error));
    return json({ok: true});
  }

  return badRequest("Unknown trade status.");
}
