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
  /** Brand colour used to draw the mark when no logo file is bundled. */
  color: string;
  /** Where the launchpad lists this specific token. */
  tokenUrl: string;
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
  imageUrl: string | null;
  priceUsd: number;
  changePct: number;
  volume24hUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  holders: number;
  createdAt: string;
  /** Ticker of the RWA on the other side of the pool. */
  pairedTicker: string;
  launchpad: Launchpad;
  socials: SocialLinks;
  description: string;
  series: number[];
}

export type Asset = RwaAsset | TokenAsset;

export interface ChartPoint {
  /** Epoch milliseconds. */
  t: number;
  price: number;
}

export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface Trade {
  id: string;
  side: "buy" | "sell";
  /** Base units of the asset moved. */
  amount: number;
  amountUsd: number;
  priceUsd: number;
  /** Wallet that traded. Rendered short, links to the explorer. */
  maker: string;
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
}

export interface Profile {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  bio: string;
  socials: SocialLinks;
  wallet: string;
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
