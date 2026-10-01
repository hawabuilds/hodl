import {db} from "@/lib/server/db";
import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Whether the signed-in person closed the mobile Home banner, kept on their
 * profile so it stays closed on every device. Before
 * scripts/schema-home-banner.sql runs the column is missing: reads answer
 * "not closed" and writes report it, and the browser's own copy carries on.
 */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const {data, error} = await db()
    .from("users")
    .select("home_banner_closed_at")
    .eq("id", caller.userId)
    .maybeSingle();
  if (error) return json({closed: false, stored: false});
  return json({closed: Boolean(data?.home_banner_closed_at), stored: true});
}

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  const {error} = await db()
    .from("users")
    .update({home_banner_closed_at: new Date().toISOString()})
    .eq("id", caller.userId);
  if (error) return json({closed: true, stored: false});
  return json({closed: true, stored: true});
}
