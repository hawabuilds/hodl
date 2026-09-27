import {db, hasDatabase} from "../db";
import {normalizeAddress} from "@/lib/address";

/**
 * Did hodl launch this token?
 *
 * Written only by `/api/launch/confirm`, and only after it has read the
 * launch out of the transaction's own receipt — so a row here means the
 * chain agreed, not that a client claimed it.
 *
 * Answers are cached for the life of the process because they cannot change:
 * a token hodl launched was always launched by hodl, and one it did not never
 * becomes one. The negative is cached too, which matters — most tokens the
 * indexer sees are not ours, and each would otherwise cost a query.
 */
const known = new Map<string, boolean>();

export async function launchedByHodl(address: string): Promise<boolean> {
  if (!hasDatabase) return false;
  const wanted = normalizeAddress(address);

  const cached = known.get(wanted);
  if (cached !== undefined) return cached;

  try {
    const {data, error} = await db()
      .from("launches")
      .select("address")
      .eq("address", wanted)
      .maybeSingle();
    // A failed read is not a "no" worth remembering — leaving it uncached
    // means the next pass asks again rather than persisting a wrong answer.
    if (error) return false;
    const hit = Boolean(data);
    known.set(wanted, hit);
    return hit;
  } catch {
    return false;
  }
}

/** Remember a launch we just recorded, so the next read does not go to the DB. */
export function noteHodlLaunch(address: string): void {
  known.set(normalizeAddress(address), true);
}
