import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";
import {between, pick, rng} from "./rng";
import {RWA_SEEDS} from "./universe";

/**
 * The news tab's feed.
 *
 * Two kinds of entry, deliberately held to different standards:
 *
 * Coverage is generated from templates and attributed to outlets that do not
 * exist, flagged `sample` so the UI can label the whole feed as placeholder.
 * Nothing here is reporting, and it is not dressed up as any.
 *
 * Accounts are the real Robinhood ones, and they carry no invented posts. A
 * card links out to the account and says plainly that live posts arrive when a
 * provider is connected — putting words in a named person's mouth would be a
 * fabricated record, sample flag or not.
 *
 * TODO(live): replace `buildFeed` with a headline provider keyed by ticker plus
 * the X API for the accounts below. The `sample` flag is what the UI reads to
 * decide whether to caveat the feed; drop it only once both are real.
 */

interface AccountSeed {
  handle: string;
  name: string;
  line: string;
}

const ACCOUNTS: AccountSeed[] = [
  {
    handle: "RobinhoodApp",
    name: "Robinhood",
    line: "Product and listing announcements post here first.",
  },
  {
    handle: "RobinhoodCrypto",
    name: "Robinhood Crypto",
    line: "Chain, token and custody updates.",
  },
  {
    handle: "vladtenev",
    name: "Vlad Tenev",
    line: "Co-founder and CEO. Long-form threads on tokenization.",
  },
];

const RWA_HEADLINES = [
  "{name} tokenized supply on Robinhood Chain reaches a new high",
  "Liquidity in {ticker} pairs deepens as market makers step in",
  "{name} volume picks up ahead of the next earnings print",
  "What round-the-clock trading has changed for {ticker} holders",
  "{name} wrapper and underlying diverge intraday, then close the gap",
  "Desk note: how {ticker} has traded since the RWA listing",
  "{name} added to more RWA-paired pools this week",
  "Where {ticker} sits after a month of tokenized trading",
];

const ROBINHOOD_HEADLINES = [
  "Robinhood expands tokenized equity access to more markets",
  "Robinhood Chain settles a record week of tokenized volume",
  "How Robinhood's tokenized equity wrapper actually settles",
  "Robinhood Chain validator set widens again",
  "Tokenization desk: what Robinhood shipped this quarter",
  "Robinhood adds settlement windows for more tickers",
  "Reading Robinhood's latest numbers through the RWA lens",
  "Retail flow is moving on-chain. Robinhood is where it lands.",
];

const OUTLETS = [
  "Market Wire",
  "Chain Desk",
  "The Ledger",
  "Onchain Daily",
  "Settlement Weekly",
];

/** Milliseconds each window reaches back. `all` is capped at a year. */
const WINDOW_MS: Record<NewsWindow, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

/**
 * Builds the whole feed once, then filters it.
 *
 * Generating per window would mean the same story appeared at a different time
 * depending on which filter was active. Bucketed by the hour so the feed grows
 * over a session rather than reshuffling on every request.
 */
function buildFeed(now: number): FeedItem[] {
  const next = rng(`feed:${Math.floor(now / 3_600_000)}`);
  const items: FeedItem[] = [];

  for (let i = 0; i < 34; i++) {
    const seed = pick(next, RWA_SEEDS);
    items.push({
      id: `rwa-news-${i}`,
      kind: "article",
      body: pick(next, RWA_HEADLINES)
        .replaceAll("{name}", seed.name)
        .replaceAll("{ticker}", seed.ticker),
      url: "#",
      source: pick(next, OUTLETS),
      handle: null,
      publishedAt: new Date(
        now - between(next, 0.4, 30 * 24) * 3_600_000,
      ).toISOString(),
      tickers: [seed.ticker],
      topic: "rwa",
      sample: true,
    });
  }

  for (let i = 0; i < 18; i++) {
    items.push({
      id: `rh-news-${i}`,
      kind: "article",
      body: pick(next, ROBINHOOD_HEADLINES),
      url: "#",
      source: pick(next, OUTLETS),
      handle: null,
      publishedAt: new Date(
        now - between(next, 0.4, 30 * 24) * 3_600_000,
      ).toISOString(),
      tickers: [],
      topic: "robinhood",
      sample: true,
    });
  }

  for (const [i, account] of ACCOUNTS.entries()) {
    items.push({
      id: `account-${account.handle}`,
      kind: "account",
      body: account.line,
      url: `https://x.com/${account.handle}`,
      source: account.name,
      handle: account.handle,
      // Spread across the last few hours so the accounts sit near the top of a
      // 24h view without all landing on the same minute.
      publishedAt: new Date(now - (i + 1) * 40 * 60_000).toISOString(),
      tickers: [],
      topic: "robinhood",
      sample: true,
    });
  }

  return items.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

export interface FeedQuery {
  window: NewsWindow;
  topic: NewsTopic;
  query?: string;
}

export function feedFor(
  {window, topic, query}: FeedQuery,
  now: number = Date.now(),
): FeedItem[] {
  const cutoff = now - WINDOW_MS[window];
  const q = query?.trim().toLowerCase() ?? "";

  return buildFeed(now).filter((item) => {
    if (Date.parse(item.publishedAt) < cutoff) return false;

    if (topic === "posts" && item.kind !== "account") return false;
    if (topic === "rwa" && item.topic !== "rwa") return false;
    // Accounts belong to the Robinhood topic and to their own tab, but a
    // Robinhood filter that hid them would be hiding the primary sources.
    if (topic === "robinhood" && item.topic !== "robinhood") return false;

    if (!q) return true;
    return (
      item.body.toLowerCase().includes(q) ||
      item.source.toLowerCase().includes(q) ||
      item.tickers.some((ticker) => ticker.toLowerCase().includes(q))
    );
  });
}
