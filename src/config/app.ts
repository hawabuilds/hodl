export const APP_NAME = "RWA";
export const APP_TAGLINE = "Every tokenized stock, and everything trading against it";
export const APP_SUBTITLE =
  "Trending Robinhood RWAs and the tokens with RWA liquidity, in one feed.";

/** Domain used in share copy. Swap once the real domain is registered. */
export const APP_DOMAIN = "rwa.xyz";

/**
 * Feed first, then the things you are watching, then your own book.
 */
export const TABS = [
  {href: "/home", label: "Home", key: "home"},
  {href: "/watchlist", label: "Watchlist", key: "watchlist"},
  {href: "/profile", label: "Profile", key: "profile"},
] as const;

export type TabKey = (typeof TABS)[number]["key"];
