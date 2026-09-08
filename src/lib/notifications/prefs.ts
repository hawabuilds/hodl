import {
  DEFAULT_HOLDINGS_MULTIPLES,
  DEFAULT_WATCHLIST_MULTIPLES,
  type Milestone,
} from "./milestones";

export type NotificationPrefs = {
  muted: boolean;
  socialFollow: boolean;
  socialReply: boolean;
  holdingsOn: boolean;
  holdingsMultiples: Milestone[];
  watchlistOn: boolean;
  watchlistMultiples: Milestone[];
  minPositionUsd: number;
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  muted: false,
  socialFollow: true,
  socialReply: true,
  holdingsOn: true,
  holdingsMultiples: DEFAULT_HOLDINGS_MULTIPLES,
  watchlistOn: false,
  watchlistMultiples: DEFAULT_WATCHLIST_MULTIPLES,
  minPositionUsd: 10,
  quietStart: null,
  quietEnd: null,
  timezone: "UTC",
};
