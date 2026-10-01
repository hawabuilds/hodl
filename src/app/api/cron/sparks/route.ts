import {json} from "@/lib/server/http";
import {buildSparks} from "@/lib/server/live/sparkBuilder";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Token rows' mini charts, rebuilt behind the lists (see sparkBuilder.ts). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }
  const started = Date.now();
  try {
    return json({...(await buildSparks({budgetMs: 90_000})), ms: Date.now() - started});
  } catch (error) {
    console.error("spark build failed", error);
    return json({error: String(error)}, 500);
  }
}
