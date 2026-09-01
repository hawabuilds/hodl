import {NextResponse} from "next/server";
import type {AssetKind, Timeframe} from "@/lib/types";
import {TIMEFRAMES} from "@/lib/types";

/**
 * Shared route helpers.
 *
 * Every response is `no-store`: the whole market moves on a one-minute cadence,
 * and Next will happily cache a route handler's GET for the life of a
 * deployment otherwise.
 */
export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

export function badRequest(message: string) {
  return json({error: message}, 400);
}

export function notFound(message = "Not found") {
  return json({error: message}, 404);
}

export function parseKind(value: string): AssetKind | null {
  return value === "rwa" || value === "token" ? value : null;
}

export function parseTimeframe(value: string | null): Timeframe {
  const match = TIMEFRAMES.find((tf) => tf === value);
  return match ?? "1h";
}
