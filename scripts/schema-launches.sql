-- Tokens launched through hodl itself.
-- Additive. Safe to re-run. Paste into the Supabase SQL editor.
--
-- This is provenance, not a second copy of the token. `tokens` stays the
-- record of what exists; this says which of those rows hodl created, and is
-- written only by /api/launch/confirm after it has read the launch out of the
-- transaction's own receipt.
--
-- It exists because `longWriteEligible()` asks whether app.long.xyz made a
-- token, by looking for URI fields that app writes. A hodl launch goes through
-- the real Airlock but not through their front end, so it lacks those fields
-- and would be marked a fake. Knowing we launched it is better evidence than
-- a heuristic, and it lets the heuristic go on catching the clones it is for.

CREATE TABLE IF NOT EXISTS launches (
  address text PRIMARY KEY,
  launchpad text NOT NULL,
  -- Privy DID of the person who launched it.
  launched_by text,
  tx_hash text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "Did hodl launch this?" is the only question asked of this table, and it is
-- asked by primary key, so no further index is needed.

CREATE INDEX IF NOT EXISTS launches_launched_by
  ON launches (launched_by, created_at DESC);
