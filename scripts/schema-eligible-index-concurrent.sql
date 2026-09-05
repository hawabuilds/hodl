-- Only if pg_index shows tokens_feed_listed with indisvalid = false.
-- CONCURRENTLY cannot run inside a transaction. Paste as a single statement.

DROP INDEX IF EXISTS tokens_feed_listed;

CREATE INDEX CONCURRENTLY tokens_feed_listed
  ON tokens (listed_at DESC, address DESC)
  WHERE status = 'listed'
    AND launchpad IS NOT NULL
    AND eligible IS DISTINCT FROM false;
