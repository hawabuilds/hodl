-- Following feed, bell and alerts (desktop). Safe to re-run.
--
-- hodl_trades   fills made through HODL, verified on chain against a wallet
--               linked to the trader's Privy account before they are written.
-- alert_prefs   in-app alert switches and the two "seen up to" marks that
--               drive the Following count and the bell. No push, no email.
--
-- The app reads and writes both with the service role and checks the caller
-- itself. RLS is on so nothing else can: anon sees nothing, and a signed-in
-- user token (Privy DID in `sub`) can only reach its own rows.

CREATE TABLE IF NOT EXISTS hodl_trades (
  tx_hash      text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet       text NOT NULL,
  side         text NOT NULL CHECK (side IN ('buy', 'sell')),
  kind         text NOT NULL CHECK (kind IN ('token', 'rwa')),
  asset_id     text NOT NULL,
  symbol       text NOT NULL,
  token_amount double precision NOT NULL,
  -- Null when the dollar leg could not be read from the receipt. Never guessed.
  usd          double precision,
  traded_at    timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hodl_trades_user_traded
  ON hodl_trades (user_id, traded_at DESC);

ALTER TABLE hodl_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hodl_trades own read" ON hodl_trades;
CREATE POLICY "hodl_trades own read" ON hodl_trades
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

-- Switches are three-state: null means never touched, which reads as on.
-- Check them with IS DISTINCT FROM false, never = true.
CREATE TABLE IF NOT EXISTS alert_prefs (
  user_id           text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  follow_buys       boolean,
  follow_sells      boolean,
  follow_comments   boolean,
  replies           boolean,
  new_followers     boolean,
  popups            boolean,
  min_trade_usd     numeric(20, 2) NOT NULL DEFAULT 0 CHECK (min_trade_usd >= 0),
  following_seen_at timestamptz,
  bell_seen_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_prefs own read" ON alert_prefs;
CREATE POLICY "alert_prefs own read" ON alert_prefs
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "alert_prefs own insert" ON alert_prefs;
CREATE POLICY "alert_prefs own insert" ON alert_prefs
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "alert_prefs own update" ON alert_prefs;
CREATE POLICY "alert_prefs own update" ON alert_prefs
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- The bell reads replies to your comments and your new followers straight
-- from comments and follows; these keep those reads on an index.
CREATE INDEX IF NOT EXISTS comments_parent_id
  ON comments (parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS follows_following_created
  ON follows (following_id, created_at DESC);
