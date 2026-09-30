-- Indexes for the desktop Tokens table. Run AFTER scripts/schema-tokens-table.sql.
--
-- CONCURRENTLY builds without locking the tokens table, which the indexer
-- writes to all the time. It cannot run inside a transaction, so run the
-- statements ONE AT A TIME in the Supabase SQL editor (select a statement,
-- run it, wait for it to finish, then the next). Safe to re-run.
--
-- Why: without these, a page of the New tab took 8–18 s, because Postgres read
-- all 35,000 listed rows out of the 370,000-row tokens table for every query.
-- With a small index over just the listed universe, and one per sortable stats
-- column, the same pages measured under 100 ms (on a copy of production data).

-- The listed universe, covering what the table filters and groups on. The
-- WHERE clause must match hodl_token_page's universe predicate exactly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tokens_list_universe
  ON tokens (address) INCLUDE (quote_token, quote_kind, listed_at)
  WHERE status = 'listed' AND launchpad IN ('pons', 'long') AND eligible IS DISTINCT FROM false;

-- Age, both ways.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tokens_list_age_desc
  ON tokens (listed_at DESC, address)
  WHERE status = 'listed' AND launchpad IN ('pons', 'long') AND eligible IS DISTINCT FROM false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tokens_list_age_asc
  ON tokens (listed_at ASC, address)
  WHERE status = 'listed' AND launchpad IN ('pons', 'long') AND eligible IS DISTINCT FROM false;

-- "Paired with" filter and counts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tokens_list_quote
  ON tokens (quote_token, address)
  WHERE status = 'listed' AND launchpad IN ('pons', 'long') AND eligible IS DISTINCT FROM false;

-- Each sortable stats column, both ways, rows with a value only (rows without
-- one come last, by address, and need no index of their own).
-- Market cap is indexed whole: the repo never filters on "has a market cap"
-- (tokens without one must still show), and the index skips nulls anyway.
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_mcap_desc ON token_stats (last_mcap DESC, address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_mcap_asc ON token_stats (last_mcap ASC, address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_change_desc ON token_stats (price_change_24h DESC, address) WHERE price_change_24h IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_change_asc ON token_stats (price_change_24h ASC, address) WHERE price_change_24h IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_liq_desc ON token_stats (liquidity_usd DESC, address) WHERE liquidity_usd IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_liq_asc ON token_stats (liquidity_usd ASC, address) WHERE liquidity_usd IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_vol_desc ON token_stats (vol_24h DESC, address) WHERE vol_24h IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_vol_asc ON token_stats (vol_24h ASC, address) WHERE vol_24h IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_txns_desc ON token_stats (txns_24h DESC, address) WHERE txns_24h IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_txns_asc ON token_stats (txns_24h ASC, address) WHERE txns_24h IS NOT NULL;

-- Trending: tokens whose volume was measured in the last day.
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_stats_vol_at
  ON token_stats (vol_at DESC) WHERE vol_24h > 0;
