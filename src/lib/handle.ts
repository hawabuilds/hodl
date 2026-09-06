/** Strip @ and trim. Empty means “not a handle”. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").trim();
}

/**
 * Exact, case-insensitive PostgREST `ilike` needle.
 *
 * Wildcards are escaped so a handle cannot become “any string”.
 */
export function handleIlike(raw: string): string {
  return normalizeHandle(raw).replace(/[%_]/g, (ch) => "\\" + ch);
}

/** Display handle when the users row has not picked one yet. */
export function fallbackHandle(
  user: {handle?: string | null; id?: string} | null | undefined,
): string | null {
  if (user?.handle) return user.handle;
  if (user?.id) return user.id.slice(-8);
  return null;
}
