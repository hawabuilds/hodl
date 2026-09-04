-- Display flag only. Never delete a token for low liquidity.
-- Paste into the Supabase SQL editor. Safe to re-run.
--
-- is_tradeable:
--   true  = measured live pool, liquidity_usd >= MIN_LIQUIDITY_USD ($500)
--   false = measured and below the floor (hide from New / Trending)
--   null  = not yet measured (SHOW — do not treat as $0)
--
-- Feeds query `is_tradeable IS DISTINCT FROM false` (true OR null).
-- Never filter this column as two-state. Null must show.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_tradeable boolean;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS liquidity_usd numeric;

CREATE INDEX IF NOT EXISTS tokens_is_tradeable ON tokens (is_tradeable);
CREATE INDEX IF NOT EXISTS tokens_liquidity_usd ON tokens (liquidity_usd);

UPDATE tokens t
SET
  liquidity_usd = s.liquidity_usd,
  is_tradeable = CASE
    WHEN s.liquidity_usd IS NULL THEN NULL
    WHEN s.liquidity_usd >= 500 THEN true
    ELSE false
  END
FROM token_stats s
WHERE t.address = s.address;
