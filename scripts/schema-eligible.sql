-- Universe eligibility flag. Safe to re-run. Paste ONE statement at a time.
-- Do NOT paste this whole file — the old full-table UPDATE timed out and
-- locked `tokens`, which emptied the app.
--
-- THREE-STATE: true = show, false = hide, null = not yet evaluated = show.
-- Reads: hide only when the flag is an evaluated false.

-- 1. Column only. Instant. Then run: npm run backfill:eligible
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS eligible boolean;

-- 2. After the backfill finishes (not before):
-- CREATE INDEX IF NOT EXISTS tokens_feed_listed
--   ON tokens (listed_at DESC, address DESC)
--   WHERE status = 'listed'
--     AND launchpad IS NOT NULL
--     AND eligible IS DISTINCT FROM false;

-- 3. Optional. The rewards writer no longer needs this trigger.
-- DROP TRIGGER IF EXISTS reward_distributions_ensure_token ON reward_distributions;
-- DROP FUNCTION IF EXISTS ensure_token_row();
