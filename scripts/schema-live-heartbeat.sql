-- Heartbeat for the Railway live-tip worker. Safe to re-run.
-- last_run_at / blocks_behind let the app show whether indexing is live.

ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS blocks_behind bigint;

INSERT INTO indexer_state (name, last_block)
VALUES ('live-tip', 0)
ON CONFLICT (name) DO NOTHING;
