import type {NextRequest} from "next/server";
import {json} from "@/lib/server/http";
import {rpcSnapshot} from "@/lib/server/live/rpcMeter";

export const dynamic = "force-dynamic";

/**
 * What this instance has spent on chain requests.
 *
 * Behind the cron secret because it describes infrastructure, not the market,
 * and because an open counter is a free way for anyone to watch how busy the
 * app is. Serverless means this reports one instance rather than the whole
 * deployment — the useful number here is the rate, which is per instance
 * anyway, not the total.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("key");

  if (!secret || offered !== secret) {
    return json({error: "Not found."}, 404);
  }

  return json(rpcSnapshot());
}
