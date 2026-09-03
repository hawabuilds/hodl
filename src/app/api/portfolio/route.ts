import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {holdingsFor} from "@/lib/server/live/holdings";

export const dynamic = "force-dynamic";

/** What the signed-in wallet holds. The reading itself lives in `holdings`. */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet || /^0x[0-9a-fA-F]{40}$/.test(wallet) === false) {
    return badRequest("A wallet address is required.");
  }

  return json(await holdingsFor(wallet));
}
