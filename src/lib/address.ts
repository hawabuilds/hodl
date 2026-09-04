/**
 * One form for every address we store or look up: lowercase.
 *
 * The tokens table stores `0xabc…`. A checksummed `.eq("address")` returns
 * nothing. Every write, every read, and every user-supplied address must pass
 * through here before it hits Supabase or is compared to another address.
 */

const ADDRESS = /^0x[a-f0-9]{40}$/;

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeAddresses(values: Iterable<string>): string[] {
  return [...values].map(normalizeAddress);
}

export function sameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

export function isAddress(value: string): boolean {
  return ADDRESS.test(normalizeAddress(value));
}

/** Parse an unknown RPC / log value into a stored address, or null. */
export function asAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeAddress(value);
  return ADDRESS.test(normalized) ? normalized : null;
}
