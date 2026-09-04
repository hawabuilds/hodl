-- Checkpoint table for keyset backfills. Safe to re-run.
-- Paste into the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS backfill_cursors (
  job           text PRIMARY KEY,
  last_address  text NOT NULL DEFAULT '',
  processed     bigint NOT NULL DEFAULT 0,
  with_pool     bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO backfill_cursors (job)
VALUES ('pools')
ON CONFLICT (job) DO NOTHING;
