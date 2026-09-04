import type {SectorId} from "./sectors";

/**
 * The two things this app tracks. Everywhere a route, a card or a query needs
 * to say which of the two it is dealing with, it uses this — the shapes below
 * deliberately share a discriminant so one list can hold both.
 */
export type AssetKind = "rwa" | "token";

/** Robinhood classifies its tokenized assets; the badge on a chart page shows it. */
export type StockType = "stock" | "etf" | "adr" | "fund";

export interface SocialLinks {
  x: string | null;
  telegram: string | null;
  website: string | null;
  discord: string | null;
}

export interface Launchpad {
  id: string;
  name: string;
  /** Brand colour, used to draw the mark when no logo file is bundled. */
  color: string;
  /** Bundled brand mark, served from `/public`. Null falls back to the colour. */
  logoUrl: string | null;
  /** This token's page on the launchpad. */
  url: string;
}

/** An official Robinhood tokenized real-world asset. */
export interface RwaAsset {
  kind: "rwa";
  /** Stable id used in URLs. For RWAs this is the ticker, lowercased. */
  id: string;
  ticker: string;
  name: string;
  logoUrl: string | null;
  contractAddress: string;
  /** Always true for an RWA in this app — nothing unofficial gets the badge. */
  verified: true;
  stockType: StockType;
  sector: SectorId;
  description: string;
  priceUsd: number;
  changePct: number;
  volume24hUsd: number;
  marketCapUsd: number;
  /**
   * Units in circulation, read from the chain, or null when that read failed
   * and `marketCapUsd` came from the indexer instead.
   *
   * Carried explicitly so a surface showing a cap at a fresher price multiplies
   * the real supply rather than dividing the rounded cap back by the rounded
   * price to guess at one — a round trip that loses precision and, when the
   * cap never was supply times price, invents a supply that does not exist.
   */
  circulatingSupply: number | null;
  /** Card sparkline. The chart page fetches its own, denser series. */
  series: number[];
}

/** A token whose liquidity pool is paired against a tokenized RWA. */
export interface TokenAsset {
  kind: "token";
  /** Stable id used in URLs. For tokens this is the contract address. */
  id: string;
  address: string;
  symbol: string;
  name: string;
  /**
   * Best available PFP: stored WebP if we have one, otherwise the remote
   * URL the indexer saved. Null only when every source missed — Avatar
   * then paints a generated mark from the address.
   */
  imageUrl: string | null;
  imageUrl64?: string | null;
  /** Remaining URLs to try if `imageUrl` / `imageUrl64` fail to load. */
  imageFallbacks?: string[];
  /** Average colour of the stored PFP, painted behind the img. */
  imageColor?: string | null;
  /** Null means unpriced. Never render as "$0". */
  priceUsd: number | null;
  changePct: number;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  /**
   * Units in circulation, read from the chain, or null when that read failed
   * and `marketCapUsd` came from the indexer instead.
   *
   * Carried explicitly so a surface showing a cap at a fresher price multiplies
   * the real supply rather than dividing the rounded cap back by the rounded
   * price to guess at one — a round trip that loses precision and, when the
   * cap never was supply times price, invents a supply that does not exist.
   */
  circulatingSupply: number | null;
  liquidityUsd: number | null;
  /**
   * Live pool at or above MIN_LIQUIDITY_USD. Null means not measured yet —
   * that is not "untradeable" and must not hide the row.
   */
  tradeable: boolean | null;
  /**
   * Pool fees earned over the last 24 hours and paid back to liquidity
   * providers.
   */
  rewards24hUsd: number;
  /**
   * Whether this token's trading fees are routed back to the people holding
   * it, rather than to the creator's wallet. What the Rewards filter selects
   * on — see `server/live/holderRewards.ts`.
   */
  rewardsToHolders: boolean;
  /**
   * Whether the token has finished bonding and trades in a real pool. False
   * while it is still on its launchpad's curve, where the "liquidity" on show
   * is the curve's own reserve rather than a market.
   */
  graduated: boolean;
  /** Graduation confirmed on-chain via Pons factory phase or Long pool(). */
  graduatedOnChain: boolean;
  /** Listed pool is on Uniswap (post-graduation AMM), not the bonding curve. */
  tradesOnUniswap: boolean;
  /**
   * Pays holders in RWA stock tokens (indexed in Supabase). When the DB is
   * unavailable the feed falls back to `rewardsToHolders`.
   */
  paysRwaRewards: boolean;
  /**
   * Volume and price move over each window the feed offers, so a filter set to
   * "1h" ranks on the hour rather than re-slicing a day's figure.
   */
  windows: Record<FeedWindow, {volumeUsd: number; changePct: number}>;
  holders: number;
  createdAt: string;
  /** Bond time for Pons, launch time for Long — New feed sort key. */
  listedAt: string | null;
  /** Ticker of the RWA on the other side of the pool. */
  pairedTicker: string;
  /**
   * Whether the other side of the pool is an actual tokenized stock rather than
   * a plain quote asset like WETH or USDG. "RWA related" means this.
   */
  rwaPaired: boolean;
  /**
   * What a trade costs beyond the price, in percent: the pool's swap fee plus
   * any fee-on-transfer the token charges in that direction.
   *
   * Null means not measured, which is not the same as zero and must never be
   * shown as "none" — see `server/live/taxes.ts`. Only populated on a single
   * asset, since the figure is read on a chart page rather than in the feed.
   */
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /**
   * Who receives that tax, when the launchpad records it on-chain.
   *
   * Null where nothing publishes a split. Note there is no holder share in it:
   * see `server/live/taxes.ts`.
   */
  feeSplit: {
    basePct: number;
    creatorPct: number;
    buybackEnabled: boolean;
  } | null;
  /**
   * The launchpad the token was deployed from, or null when it came from one
   * this app cannot prove. Null is the common case and is not a gap to fill
   * with a guess — see `server/live/launchpads.ts`.
   */
  launchpad: Launchpad | null;
  socials: SocialLinks;
  description: string;
  series: number[];
}

/** Windows the feed can be ranked and filtered over. */
export const FEED_WINDOWS = ["5m", "1h", "6h", "24h"] as const;
export type FeedWindow = (typeof FEED_WINDOWS)[number];

export type Asset = RwaAsset | TokenAsset;

export interface ChartPoint {
  /** Epoch milliseconds. */
  t: number;
  price: number;
}

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Windows for the portfolio chart, which is read over months rather than hours. */
export const RANGES = ["1D", "1W", "1M", "1Y", "ALL"] as const;
export type Range = (typeof RANGES)[number];

export interface Trade {
  id: string;
  side: "buy" | "sell";
  /** Base units of the asset moved. */
  amount: number;
  amountUsd: number;
  priceUsd: number;
  /** Wallet that traded. Rendered short, links to the explorer. */
  maker: string;
  /** The transaction the fill settled in. Shown in the TXN column. */
  txHash: string;
  /** Set when the maker is someone with a profile in the app. */
  makerHandle: string | null;
  at: string;
}

export interface CommentAuthor {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
}

export interface AssetComment {
  id: string;
  assetId: string;
  parentId: string | null;
  author: CommentAuthor;
  body: string;
  createdAt: string;
}

export interface CommentThread {
  root: AssetComment;
  replies: AssetComment[];
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// The news feed
// ---------------------------------------------------------------------------

export const NEWS_WINDOWS = ["24h", "7d", "30d", "all"] as const;
export type NewsWindow = (typeof NEWS_WINDOWS)[number];

export const NEWS_TOPICS = ["all", "rwa", "robinhood", "posts"] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];

/**
 * One entry in the news feed.
 *
 * Two shapes share it: a piece of coverage, and an account worth following.
 * They are rendered differently but sorted and filtered together, because what
 * someone wants from this tab is one chronological stream.
 */
export interface FeedItem {
  id: string;
  kind: "article" | "account";
  /** Headline, or the account's standing line. */
  body: string;
  url: string;
  /** Outlet name, or the account's display name. */
  source: string;
  /** X handle. Accounts only. */
  handle: string | null;
  publishedAt: string;
  /** Tickers the item concerns; rendered as chips through to the RWA page. */
  tickers: string[];
  topic: "rwa" | "robinhood";
  /** Artwork from the publisher, when the story carries one. */
  imageUrl: string | null;
  /** The account's profile picture. Accounts only. */
  avatarUrl: string | null;
  /** True while the item is a placeholder rather than something fetched. */
  sample: boolean;
}

export interface Holding {
  kind: AssetKind;
  /** Matches Asset.id, so a row links straight to its chart page. */
  assetId: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  amount: number;
  valueUsd: number;
  changePct: number;
  /**
   * Total put in, where this platform recorded the fills.
   *
   * Null for a balance that arrived from anywhere else, which is most of them —
   * and null is not zero. A zero cost makes a position's entire value read as
   * profit, so a row without a basis shows the asset's own move instead.
   */
  costUsd: number | null;
}

export interface Profile {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  bio: string;
  socials: SocialLinks;
  /**
   * The account's wallet, and only ever their own.
   *
   * Null on anyone else's profile. A handle is public and a balance sheet is
   * arguably part of the pitch, but the address that ties them together is not
   * something a viewer needs — it would let anyone follow every trade the
   * person has ever made, on any chain, for good.
   */
  wallet: string | null;
  followers: number;
  following: number;
  holdings: Holding[];
}

export interface OrderDraft {
  assetId: string;
  side: "buy" | "sell";
  /** Always denominated in USD; the sheet converts to units for display. */
  amountUsd: number;
}
