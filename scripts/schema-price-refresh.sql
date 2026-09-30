-- Stored price refresh by activity. Safe to re-run.
--
-- price_moved_at: when a token's pool price last moved. Pool prices only move
-- on a swap, so this is when it last traded, as far as the refresh job can see.
-- The job refreshes every token that moved (or showed volume) in the last week
-- on every tick, most-traded first, and the rest about once a day.
--
-- Until this runs, the job ranks on recent volume alone and writes without it.

ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS price_moved_at timestamptz;

CREATE INDEX IF NOT EXISTS token_stats_price_moved_at
  ON token_stats (price_moved_at DESC) WHERE price_moved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS token_stats_priced_at_priced
  ON token_stats (priced_at) WHERE price_status = 'priced';

CREATE INDEX IF NOT EXISTS token_stats_vol_24h
  ON token_stats (vol_24h DESC NULLS LAST);
