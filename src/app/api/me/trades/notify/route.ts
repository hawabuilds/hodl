import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {recordHodlTrade} from "@/lib/server/hodlTrades";
import {notifyTradeFailed, notifyTradeFilled} from "@/lib/server/notifications/trades";

export const dynamic = "force-dynamic";
// Recording waits up to 30s for our node to see the receipt.
export const maxDuration = 60;

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
    /** A retry of a save that did not go through: record it, notify nobody twice. */
    recordOnly?: boolean;
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
    // Saved first, and alongside the alerts rather than after them: trade
    // history, follow alerts and suggested traders all read this table, and a
    // slow notification used to hold the save up until the function ran out.
    // Written only once the chain confirms it; the amounts above are the
    // ticket's claim and are not what gets stored.
    const recording =
      typeof body.txHash === "string"
        ? recordHodlTrade({userId: caller.userId, txHash: body.txHash, kind, assetId, symbol: ticker}).catch(
            (error): {recorded: false; reason: string} => {
              console.error("hodl trade record failed", error);
              return {recorded: false, reason: "error"};
            },
          )
        : Promise.resolve({recorded: false as const, reason: "no tx hash"});
    const notifying = body.recordOnly
      ? Promise.resolve()
      : notifyTradeFilled({
          userId: caller.userId,
          side,
          kind,
          assetId,
          ticker,
          tokenAmount,
          quoteAmount,
          quoteSymbol,
        }).catch((error) => console.error("trade fill notify failed", error));
    const [result] = await Promise.all([recording, notifying]);
    if (!result.recorded) console.warn("hodl trade not recorded:", result.reason);
    return json({ok: true, recorded: result.recorded, reason: result.recorded ? null : result.reason});
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
