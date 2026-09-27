import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {db, hasDatabase} from "@/lib/server/db";
import {rpc} from "@/lib/server/live/chain";
import {qualifyAndInsert} from "@/lib/server/live/qualify";
import {normalizeAddress} from "@/lib/address";
import {launchedToken} from "@/lib/launch/launchReceipt";
import {noteHodlLaunch} from "@/lib/server/live/launchProvenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Register a launch that has landed, so it shows up in hodl straight away.
 *
 * Without this a new token is invisible here until the indexer's live tip
 * happens to reach it, and the person who just paid to launch it finds no
 * page for what they made.
 *
 * Nothing is taken on trust. The client sends a transaction hash and nothing
 * else that matters: the token address is read out of that transaction's own
 * receipt, from a log emitted by the launchpad's own contract, so a caller
 * cannot name someone else's token — or a token that does not exist — and
 * have it written. `qualifyAndInsert` then applies the same attribution rule
 * the indexer applies, reading the launchpad back off the token itself.
 *
 * The provenance row is the other half. hodl knows what it launched, which is
 * better evidence than the app.long.xyz URI heuristic for a token we made
 * ourselves — see `longAuthenticityFromSignals`.
 */

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!hasDatabase) return json({error: "Token store is not configured."}, 503);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const txHash = typeof body.txHash === "string" ? body.txHash : "";
  const launchpad = body.launchpad === "long" ? "long" : "pons";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json({error: "Which launch?"}, 400);
  }

  let address: string | null = null;
  try {
    const receipt = await rpc().getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return json({error: "That transaction reverted."}, 409);
    }
    address = launchedToken(receipt.logs, launchpad);
  } catch {
    // Not mined where this node can see it yet. The client should retry
    // rather than be told the launch failed, because it very likely did not.
    return json({error: "That launch is not on chain yet."}, 404);
  }

  if (!address) {
    return json({error: "That transaction did not launch a token."}, 409);
  }

  // Re-derives the launchpad from the token itself and writes the row. The
  // client's claim about which launchpad it used only picked the log to look
  // for; it is not what gets stored.
  const result = await qualifyAndInsert(address);
  if (result.status === "not_found") {
    return json({error: "That launch is not on chain yet.", address}, 404);
  }

  await recordProvenance({
    address,
    launchpad,
    userId: caller.userId,
    txHash,
    image: typeof body.image === "string" ? body.image : null,
  });

  return json({
    address,
    status: result.status,
    /**
     * `ineligible` is not an error here — the launch succeeded and the token
     * exists. It means the pair it chose keeps it out of hodl's feeds, which
     * the form is supposed to have prevented.
     */
    listed: result.status === "listed",
  });
}

/**
 * Remember that hodl launched this, so the Long authenticity check can trust
 * it later. Best effort: a launch that is already recorded and listed must
 * not be reported as failed because a bookkeeping insert did not land.
 */
async function recordProvenance(row: {
  address: string;
  launchpad: string;
  userId: string;
  txHash: string;
  image: string | null;
}): Promise<void> {
  try {
    const {error} = await db()
      .from("launches")
      .upsert(
        {
          address: normalizeAddress(row.address),
          launchpad: row.launchpad,
          launched_by: row.userId,
          tx_hash: row.txHash,
          image_url: row.image,
        },
        {onConflict: "address"},
      );
    if (error) {
      console.error("launch provenance write failed", error.message);
      return;
    }
    noteHodlLaunch(row.address);
  } catch (error) {
    console.error("launch provenance write failed", error);
  }
}
