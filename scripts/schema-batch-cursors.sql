-- Resumable batch-job cursors. One statement. Safe to re-run.
CREATE TABLE IF NOT EXISTS batch_cursors (
  name       text PRIMARY KEY,
  last_key   text,
  scanned    bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
