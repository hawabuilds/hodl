/** Quiet hours in the user's timezone. `start`/`end` are "HH:MM" 24h. Overnight ranges wrap. */

export function minutesInZone(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

export function parseHmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function inQuietHours(
  now: Date,
  opts: {timezone: string; quietStart: string | null; quietEnd: string | null},
): boolean {
  const start = parseHmm(opts.quietStart);
  const end = parseHmm(opts.quietEnd);
  if (start == null || end == null || start === end) return false;
  const mins = minutesInZone(now, opts.timezone || "UTC");
  if (mins == null) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}
