import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {db, hasDatabase} from "@/lib/server/db";
import {ensureUser} from "@/lib/server/social-live";

export const dynamic = "force-dynamic";

/** The caller's quick buy amount from the Tokens table, in dollars. Null = the default. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!hasDatabase) return json({amountUsd: null});
  const {data, error} = await db()
    .from("users")
    .select("quick_buy_usd")
    .eq("id", caller.userId)
    .maybeSingle();
  if (error) {
    // Before scripts/schema-tokens-table.sql the browser keeps it.
    if (/quick_buy_usd/i.test(error.message)) return json({amountUsd: null, stored: false});
    return json({error: "Couldn't load."}, 503);
  }
  const amount = data?.quick_buy_usd != null ? Number(data.quick_buy_usd) : null;
  return json({amountUsd: amount != null && amount > 0 ? amount : null});
}

export async function PUT(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => ({}))) as {amountUsd?: unknown};
  const amount = Number(body.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return badRequest("Enter an amount above $0.");
  }
  if (!hasDatabase) return json({amountUsd: amount});
  await ensureUser(caller.userId);
  const {error} = await db()
    .from("users")
    .update({quick_buy_usd: Math.round(amount * 100) / 100})
    .eq("id", caller.userId);
  if (error) {
    if (/quick_buy_usd/i.test(error.message)) return json({amountUsd: amount, stored: false});
    return json({error: "Couldn't save."}, 503);
  }
  return json({amountUsd: amount});
}
