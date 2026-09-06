-- Portfolio value over time. Additive. Safe to re-run.
-- Paste into the Supabase SQL editor if the table is not already there.

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id            bigserial PRIMARY KEY,
  wallet        text NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  hour_bucket   timestamptz NOT NULL,
  total_usd     numeric(24, 6) NOT NULL,
  positions_usd numeric(24, 6),
  eth_usd       numeric(24, 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_wallet_hour
  ON portfolio_snapshots (wallet, hour_bucket);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_wallet_captured
  ON portfolio_snapshots (wallet, captured_at DESC);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
