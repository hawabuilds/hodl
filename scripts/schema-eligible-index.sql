-- One statement. Safe to re-run. Do not combine with a full-table UPDATE.
-- If an older tokens_feed_listed already exists, this is a no-op.
CREATE INDEX IF NOT EXISTS tokens_feed_listed
  ON tokens (listed_at DESC, address DESC)
  WHERE status = 'listed'
    AND launchpad IS NOT NULL
    AND eligible IS DISTINCT FROM false;
