export const APP_NAME = "RWA";
export const APP_TAGLINE = "Every tokenized stock, and everything trading against it";
export const APP_SUBTITLE =
  "Trending Robinhood RWAs and the tokens with RWA liquidity, in one feed.";

/** Domain used in share copy. Swap once the real domain is registered. */
export const APP_DOMAIN = "rwa.xyz";

/**
 * The four destinations. Labels are for screen readers and tooltips only — the
 * bar itself is icons, so each one has to be unambiguous on its own.
 *
 * The watchlist is not here: it lives inside the feed as a tab, where it is
 * read against the same rows it filters.
 */
export const TABS = [
  {href: "/home", label: "Home", key: "home"},
  {href: "/search", label: "Search", key: "search"},
  {href: "/news", label: "News", key: "news"},
  {href: "/profile", label: "Profile", key: "profile"},
] as const;

export type TabKey = (typeof TABS)[number]["key"];
