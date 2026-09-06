-- Token socials, resolved at index time (launchpad first, DexScreener fills gaps).
-- Additive. Safe to re-run. Paste into the Supabase SQL editor.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS twitter text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS telegram text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS discord text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS socials_source text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS socials_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS tokens_socials_checked_at
  ON tokens (socials_checked_at ASC NULLS FIRST, address ASC)
  WHERE status = 'listed'
    AND eligible IS DISTINCT FROM false;
