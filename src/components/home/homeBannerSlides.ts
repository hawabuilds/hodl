/**
 * The mobile Home banner's slides, in order. Edit here: a slide is its title,
 * one line, the button and where it goes, and which picture sits on the right
 * (see HomeBannerArt).
 */
export interface HomeBannerSlide {
  id: string;
  title: string;
  body: string;
  cta: string;
  /** A path in the app, or "create" for the Create sheet. */
  action: string;
  art: "launch" | "follow" | "rebalance";
}

export const HOME_BANNER_SLIDES: HomeBannerSlide[] = [
  {
    id: "launch",
    title: "Launch a token on any stock",
    body: "Pick a stock, name it, live in 30 seconds.",
    cta: "Create now",
    action: "create",
    art: "launch",
  },
  {
    id: "follow",
    title: "Follow traders, see their trades live",
    body: "Get alerts when people you follow buy or sell.",
    cta: "Explore",
    action: "/activity",
    art: "follow",
  },
  {
    id: "rebalance",
    title: "Rebalance your portfolio in one tap",
    body: "Set targets and top up what's underweight.",
    cta: "Try it",
    action: "/profile?view=allocation",
    art: "rebalance",
  },
];

/** How long each slide shows before the next. */
export const HOME_BANNER_ADVANCE_MS = 5_000;
