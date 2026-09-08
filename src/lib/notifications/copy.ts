import {price} from "@/lib/format";

const compactToken = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export type DigestKind = "multiple" | "reply" | "follow" | "trade";

export type DigestMeta = {
  type: DigestKind;
  ticker?: string;
  n?: number;
  parentId?: string;
};

function stripAt(handle: string): string {
  return handle.replace(/^@/, "").trim() || "someone";
}

function atHandle(handle: string): string {
  return `@${stripAt(handle)}`;
}

function trimFloat(value: number, maxFrac: number): string {
  const abs = Math.abs(value);
  const text = abs.toLocaleString("en-US", {
    maximumFractionDigits: maxFrac,
    useGrouping: abs >= 1000,
  });
  return value < 0 ? `-${text}` : text;
}

/** `$FOO` — always dollar + uppercase. */
export function notifyTicker(symbol: string): string {
  const raw = symbol.replace(/^\$/, "").trim().toUpperCase();
  return raw ? `$${raw}` : "$TOKEN";
}

/** `$2,400` not `$2400.00`. Whole dollars drop cents. */
export function notifyMoney(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  if (abs >= 1) {
    const cents = Math.round(abs * 100);
    if (cents % 100 === 0) {
      return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
    }
    return `${sign}$${(cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${sign}${price(abs)}`;
}

/** Token size: `1.24M`, or grouped integers, or trimmed decimals. */
export function notifyTokenAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${compactToken.format(abs)}`;
  if (abs >= 1000) return `${sign}${trimFloat(abs, 2)}`;
  if (abs >= 1) return `${sign}${trimFloat(abs, 4)}`;
  return `${sign}${trimFloat(abs, 6)}`;
}

/** Quote size (`0.05` ETH) — needed decimals, no trailing zeros. */
export function notifyQuoteAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Math.abs(value) >= 1000) return notifyTokenAmount(value);
  return trimFloat(value, 8);
}

/** Collapse whitespace; cap at 80 chars + ellipsis (U+2026). Keeps user emoji. */
export function replyPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 80) return collapsed;
  return `${collapsed.slice(0, 80)}…`;
}

export function holdingsMultipleCopy(input: {
  symbol: string;
  milestone: number;
  costUsd: number;
  valueUsd: number;
}): {title: string; body: string} {
  return {
    title: `${notifyTicker(input.symbol)} is up ${input.milestone}x`,
    body: `Your ${notifyMoney(input.costUsd)} position is now ${notifyMoney(input.valueUsd)}`,
  };
}

export function watchlistMultipleCopy(input: {
  symbol: string;
  milestone: number;
  addPrice: number;
  currentPrice: number;
}): {title: string; body: string} {
  return {
    title: `${notifyTicker(input.symbol)} is up ${input.milestone}x`,
    body: `Since you added it — ${price(input.addPrice)} → ${price(input.currentPrice)}`,
  };
}

export function followCopy(handles: string[]): {title: string; body: string} {
  const tags = handles.map(atHandle);
  if (tags.length <= 1) {
    return {
      title: "New follower",
      body: `${tags[0] ?? "@someone"} started following you`,
    };
  }
  const n = tags.length;
  const title = `${n} new followers`;
  if (n === 2) {
    return {title, body: `${tags[0]}, ${tags[1]} started following you`};
  }
  return {
    title,
    body: `${tags[0]}, ${tags[1]} and ${n - 2} others started following you`,
  };
}

export function replyCopy(handle: string, replyText: string): {title: string; body: string} {
  return {
    title: `${atHandle(handle)} replied to you`,
    body: replyPreview(replyText),
  };
}

export function replyBatchCopy(n: number, ticker: string): {title: string; body: string} {
  return {
    title: `${n} new replies`,
    body: `on your comment about ${notifyTicker(ticker)}`,
  };
}

export function tradeFilledCopy(input: {
  side: "buy" | "sell";
  tokenAmount: number;
  ticker: string;
  quoteAmount: number;
  quoteSymbol: string;
}): {title: string; body: string} {
  const quote = input.quoteSymbol.replace(/^\$/, "").trim().toUpperCase() || "ETH";
  return {
    title: input.side === "buy" ? "Buy filled" : "Sell filled",
    body: `${notifyTokenAmount(input.tokenAmount)} ${notifyTicker(input.ticker)} for ${notifyQuoteAmount(input.quoteAmount)} ${quote}`,
  };
}

export function tradeFailedCopy(reason: string): {title: string; body: string} {
  const clean = reason.replace(/!+/g, "").replace(/\s+/g, " ").trim() || "The swap could not be sent";
  return {
    title: "Trade failed",
    body: `${clean} — nothing was charged`,
  };
}

export type DigestBits = {
  ticker?: string;
  milestone?: number;
  replies?: number;
  followers?: number;
};

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0]!;
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

export function digestCopy(n: number, bits: DigestBits): {title: string; body: string} {
  const clauses: string[] = [];
  if (bits.ticker && bits.milestone && bits.milestone > 0) {
    clauses.push(`${notifyTicker(bits.ticker)} hit ${bits.milestone}x`);
  }
  if (bits.replies && bits.replies > 0) {
    clauses.push(bits.replies === 1 ? "1 reply" : `${bits.replies} replies`);
  }
  if (bits.followers && bits.followers > 0) {
    clauses.push(bits.followers === 1 ? "1 new follower" : `${bits.followers} new followers`);
  }
  return {
    title: `${n} updates today`,
    body: joinClauses(clauses),
  };
}

function tickerFromTitle(title: string): string | undefined {
  const match = title.match(/\$([A-Za-z0-9]+)/);
  return match?.[1];
}

function milestoneFromTitle(title: string): number | undefined {
  const match = title.match(/\b(\d+)x\b/i);
  const n = match ? Number(match[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function payloadDigest(payload: unknown): DigestMeta | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as {d?: DigestMeta; digest?: DigestMeta};
  return row.d ?? row.digest;
}

export type DigestItem = {
  kind: string;
  title: string;
  body: string;
  payload?: unknown;
};

/** Compose a multi-item daily digest. Zero categories are omitted. */
export function digestFromItems(items: DigestItem[]): {title: string; body: string} {
  let ticker: string | undefined;
  let milestone = 0;
  let replies = 0;
  let followers = 0;
  for (const item of items) {
    const meta = payloadDigest(item.payload);
    const kind = meta?.type ?? item.kind;
    if (kind === "multiple") {
      const n = meta?.n ?? milestoneFromTitle(item.title) ?? 0;
      const symbol = meta?.ticker ?? tickerFromTitle(item.title);
      if (n > milestone) {
        milestone = n;
        ticker = symbol;
      }
    } else if (kind === "reply") {
      const batched = item.title.match(/^(\d+) new replies/);
      replies += meta?.n ?? (batched ? Number(batched[1]) : 1);
    } else if (kind === "follow") {
      const batched = item.title.match(/^(\d+) new followers/);
      followers += meta?.n ?? (batched ? Number(batched[1]) : 1);
    }
  }
  const copy = digestCopy(items.length, {
    ticker,
    milestone: milestone || undefined,
    replies,
    followers,
  });
  if (!copy.body) {
    copy.body = items[0]?.body ?? "";
  }
  return copy;
}

export function handlesFromFollowRows(
  rows: Array<{body?: string | null; payload?: unknown}>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const payload = row.payload as {handles?: string[]} | null;
    const listed = Array.isArray(payload?.handles)
      ? payload.handles
      : [...String(row.body ?? "").matchAll(/@([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    for (const handle of listed) {
      const key = stripAt(handle).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(stripAt(handle));
    }
  }
  return out;
}
