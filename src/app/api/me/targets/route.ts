import {cleanTargets, targetsValid} from "@/lib/allocation";
import {requireCaller} from "@/lib/server/auth";
import {db, hasDatabase} from "@/lib/server/db";
import {badRequest, json} from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Before scripts/schema-allocation-targets.sql is run, the table is missing. */
function missingTable(error: {code?: string} | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/** The signed-in user's allocation targets: `{targets: {}}` until they save some. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!hasDatabase) return json({targets: {}});
  const {data, error} = await db()
    .from("allocation_targets")
    .select("targets")
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (error && !missingTable(error)) {
    console.error("allocation targets read failed", error.message);
    return json({error: "Couldn't load your targets."}, 503);
  }
  return json({targets: cleanTargets(data?.targets ?? {}) ?? {}});
}

/** Save targets. They must be known holdings' keys and add up to 100%. */
export async function PUT(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as {targets?: unknown} | null;
  const targets = cleanTargets(body?.targets);
  if (!targets || !targetsValid(targets)) return badRequest("Targets must add up to 100%.");
  if (!hasDatabase) return json({targets});
  const {error} = await db()
    .from("allocation_targets")
    .upsert({user_id: caller.userId, targets, updated_at: new Date().toISOString()});
  if (error) {
    console.error("allocation targets save failed", error.message);
    return json(
      {error: missingTable(error) ? "Targets can't be saved yet." : "Couldn't save your targets."},
      503,
    );
  }
  return json({targets});
}
