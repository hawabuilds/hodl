import {json} from "@/lib/server/http";
import {indexTokens} from "@/lib/server/live/tokenIndexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  try {
    return json(await indexTokens());
  } catch (error) {
    console.error("token index failed", error);
    return json({error: String(error)}, 500);
  }
}
