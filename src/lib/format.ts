const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: number): string {
  return usd.format(value);
}

/** "$1.2B" — for market cap, volume and liquidity, where precision is noise. */
export function compactMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return usd.format(value);
  return compactUsd.format(value);
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactNumber.format(value);
}

/**
 * Prices span nine orders of magnitude here: an ETF at $682 and a token at
 * $0.000041 both have to read cleanly, so the precision follows the number
 * rather than being fixed at two places.
 */
/**
 * Always a dollar figure with a decimal point — never `1.2e-6`.
 * Tiny prices keep every leading zero so $0.000041 and $0.00000012 stay readable.
 */
function decimalUsd(abs: number): string {
  if (abs >= 1) return usd.format(abs);
  if (abs === 0) return "$0.00";
  const firstDigit = Math.floor(Math.log10(abs));
  const decimals = Math.min(18, Math.max(2, -firstDigit + 3));
  let digits = abs.toFixed(decimals);
  if (digits.includes("e") || digits.includes("E")) {
    digits = abs.toLocaleString("en-US", {
      useGrouping: false,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  digits = digits.replace(/(\.\d*?[1-9])0+$/, "$1");
  return `$${digits}`;
}

export function price(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}${decimalUsd(Math.abs(value))}`;
}

/** Token balances run to the millions; RWA balances run to fractions of a share. */
export function units(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return compactNumber.format(value);
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export function percent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function shortAddress(address: string, lead = 6): string {
  if (address.length <= lead + 6) return address;
  return `${address.slice(0, lead)}…${address.slice(-4)}`;
}

/**
 * Byline time on the news tab.
 *
 * Same calendar day uses relative time while the story is fresh, then the
 * clock ("8:51 am") so a morning wire piece is not labelled "8h ago" under
 * a masthead that already says today. This week uses the weekday once the
 * day has rolled.
 */
export function startOfLocalDay(now: number = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function newsTime(
  iso: string,
  window: "latest" | "24h" | "7d" | "30d" | "all",
  now: number = Date.now(),
): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  if (date.getTime() >= startOfLocalDay(now)) {
    const hours = (now - date.getTime()) / 3_600_000;
    if (hours < 3) return relativeTime(iso, now);
    return date.toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (window === "7d") {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  return relativeTime(iso, now);
}

/** "3m ago" — used on trades, comments and news. */
/**
 * How long ago something happened.
 *
 * Floors every step. Rounding made this both wrong and unstable: a fill ninety
 * seconds old read "2m ago", and as the clock advanced it flipped between "1m"
 * and "2m" on every re-render. Elapsed time only ever counts what has fully
 * passed, so ninety seconds is one minute until the second one completes.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Comments are theses, so they carry an absolute date and time, not "2h ago". */
export function stamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Clock time for the chart scrubber, where the date is usually obvious. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ageSince(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Compact token age for feed rows — "45m", "2h", or "5d". */
export function tokenAge(iso: string, now: number = Date.now()): string {
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
