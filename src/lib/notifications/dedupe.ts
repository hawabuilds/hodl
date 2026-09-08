/** Same follower/reply can retry; older than this is a new event. */
export const DEDUPE_WINDOW_MS = 20 * 60_000;

export function isFreshDedupe(
  createdAt: string | Date,
  now: Date = new Date(),
  windowMs = DEDUPE_WINDOW_MS,
): boolean {
  const at = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < windowMs;
}

export function followDedupeKey(targetUserId: string, followerUserId: string): string {
  return `follow:${targetUserId}:${followerUserId}`;
}
