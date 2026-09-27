import {isAddress, normalizeAddress} from "./address";

/**
 * Long.xyz launches write a Doppler Airlock clone, then stamp tokenURI JSON
 * with `fee_receiver`, `vesting_recipients`, and `categories`. Tokens that
 * only share the Airlock owner / implementation / hook were not created
 * through that app — they omit those URI fields.
 *
 * A second clone factory mines CREATE2 salts so addresses end in `ba3`.
 * Official Long vanity is `1e18`. Neither suffix is required; the URI
 * schema is the proof. `ba3` is a fast reject for the clone flood.
 *
 * Add addresses to `DENIED_FAKE_LONGS` only when those checks miss one.
 */

export const FAKE_LONG_EXAMPLE =
  "0x066820c460b6ca092a58f402ff0a72703b1af72e" as const;

/** Seed + documented extension point. Compared lowercase. */
const DENIED_FAKE_LONGS = new Set<string>([FAKE_LONG_EXAMPLE]);

const CLONE_LONG_VANITY = /ba3$/i;
const LONG_APP_VANITY = /1e18$/i;

export type LongAuthenticity = true | false | null;

export function isDeniedFakeLong(address: string): boolean {
  return DENIED_FAKE_LONGS.has(normalizeAddress(address));
}

/** Competing factory's mined suffix. Official Long app mines `1e18`. */
export function hasCloneLongVanity(address: string): boolean {
  return CLONE_LONG_VANITY.test(normalizeAddress(address));
}

export function hasLongAppVanity(address: string): boolean {
  return LONG_APP_VANITY.test(normalizeAddress(address));
}

function isHexAddress(value: unknown): boolean {
  return typeof value === "string" && isAddress(value);
}

/**
 * tokenURI JSON the Long app writes at create. Generic Doppler clones
 * stop at name / description / image_hash / social_links.
 */
export function isLongAppMetadata(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const row = body as Record<string, unknown>;
  return (
    isHexAddress(row.fee_receiver) &&
    Array.isArray(row.vesting_recipients) &&
    Array.isArray(row.categories)
  );
}

/**
 * Structural Long-app check. `null` means not yet proven — do not treat
 * that as a fail (three-state: unevaluated still shows).
 */
export function longAuthenticityFromSignals(input: {
  address: string;
  metadata?: unknown | null;
  metadataResolved?: boolean;
  /**
   * hodl launched this token itself, and proved it on chain before recording
   * it — the proxy implementation and `owner()` both checked out.
   *
   * The URI check below asks "did app.long.xyz make this", which is the right
   * question for a token we found and the wrong one for a token we made. A
   * hodl launch goes through the real Airlock and is a genuine Long launch;
   * it simply came from a different front end, so it lacks that app's fields
   * and would be marked a fake by a check it was never in scope for.
   *
   * Provenance rather than imitation. Writing app.long.xyz's signature fields
   * to slip past the heuristic would be forging their mark, and it would blind
   * the check to the clones it exists to catch.
   */
  launchedByHodl?: boolean;
}): LongAuthenticity {
  if (isDeniedFakeLong(input.address) || hasCloneLongVanity(input.address)) {
    return false;
  }
  // After the deny list, so an address explicitly marked fake stays fake.
  if (input.launchedByHodl) return true;
  if (input.metadataResolved) {
    return isLongAppMetadata(input.metadata);
  }
  return null;
}

/** Persist-time hide: only an evaluated fail becomes eligible=false. */
export function longWriteEligible(auth: LongAuthenticity): boolean {
  return auth !== false;
}
