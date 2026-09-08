-- Notifications. Safe to re-run.
-- Watchlist moves here from localStorage (kind:id strings, no add_price).
-- Holdings multiples only fire when cost_usd is set — live fills still null.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id
  ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id              text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted                boolean NOT NULL DEFAULT false,
  social_follow        boolean NOT NULL DEFAULT true,
  social_reply         boolean NOT NULL DEFAULT true,
  holdings_on          boolean NOT NULL DEFAULT true,
  holdings_multiples   integer[] NOT NULL DEFAULT '{2,5,10}',
  watchlist_on         boolean NOT NULL DEFAULT false,
  watchlist_multiples  integer[] NOT NULL DEFAULT '{2,5,10}',
  min_position_usd     numeric(20, 2) NOT NULL DEFAULT 10,
  quiet_start          text,
  quiet_end            text,
  timezone             text NOT NULL DEFAULT 'UTC',
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('token', 'rwa')),
  asset_id   text NOT NULL,
  add_price  double precision,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, asset_id)
);

CREATE INDEX IF NOT EXISTS watchlist_asset
  ON watchlist (kind, asset_id);

CREATE TABLE IF NOT EXISTS user_positions (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('token', 'rwa')),
  asset_id   text NOT NULL,
  symbol     text,
  amount     double precision NOT NULL DEFAULT 0,
  value_usd  double precision NOT NULL DEFAULT 0,
  cost_usd   double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, asset_id)
);

CREATE TABLE IF NOT EXISTS position_milestones (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  asset_id   text NOT NULL,
  source     text NOT NULL CHECK (source IN ('holdings', 'watchlist')),
  milestone  integer NOT NULL,
  fired_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, asset_id, source, milestone)
);

CREATE TABLE IF NOT EXISTS notification_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('social', 'holdings', 'watchlist')),
  kind         text NOT NULL,
  dedupe_key   text,
  title        text NOT NULL,
  body         text NOT NULL,
  url          text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_log_dedupe
  ON notification_log (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_log_user_day
  ON notification_log (user_id, channel, created_at);
