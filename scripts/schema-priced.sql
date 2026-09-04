-- On-chain price measurement. Safe to re-run. Paste into the Supabase SQL editor.
--
-- priced_at null  = we have not priced this token yet → show with "—"
-- last_mcap null  = same. Never treat null as zero. Never filter New on
--                   a missing cap. Require priced_at plus last_mcap > 0.
-- price_status    = priced | no_pool | failed | null
--   null     = not yet evaluated → show
--   no_pool  = PoolKey recovered, pool has no liquidity → hide from New
--   failed   = PoolKey missing or the read failed → hide from New
--   priced   = measured price + market cap
--
-- The New feed must not require a measured cap until >90% of listed
-- eligible tokens have priced_at IS NOT NULL AND last_mcap > 0.

ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS priced_at timestamptz;
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS price_status text;

-- Existing DexScreener rows that already have a real cap were measured.
UPDATE token_stats
SET
  priced_at = COALESCE(priced_at, updated_at, now()),
  price_status = COALESCE(price_status, 'priced')
WHERE last_mcap > 0
  AND priced_at IS NULL;

CREATE INDEX IF NOT EXISTS token_stats_measured
  ON token_stats (priced_at DESC)
  WHERE priced_at IS NOT NULL AND last_mcap > 0;

CREATE INDEX IF NOT EXISTS token_stats_price_status
  ON token_stats (price_status)
  WHERE price_status IS NOT NULL;
