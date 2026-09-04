import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {holdingsFor, nativeOnly} from "@/lib/server/live/holdings";

export const dynamic = "force-dynamic";

function walletsFrom(request: NextRequest): string[] {
  const params = request.nextUrl.searchParams;
  const many = params.get("wallets");
  const one = params.get("wallet");
  const raw = many ? many.split(",") : one ? [one] : [];
  return raw.filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()));
}

/** What the signed-in wallets hold. Accepts one `wallet` or many `wallets`. */
export async function GET(request: NextRequest) {
  const wallets = walletsFrom(request);
  if (wallets.length === 0) {
    return badRequest("A wallet address is required.");
  }

  const phase = request.nextUrl.searchParams.get("phase");
  if (phase === "native") {
    return json(await nativeOnly(wallets));
  }

  const known = (request.nextUrl.searchParams.get("known") ?? "")
    .split(",")
    .filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()));

  return json(await holdingsFor(wallets, known));
}
