-- The desktop RWAs page: tokens paired with each stock, and their volume.
-- Run AFTER scripts/schema-tokens-table.sql (it reads token_stats.vol_at).
-- Run the whole file at once in the Supabase SQL editor. Safe to re-run.
--
-- One row per stock token that at least one live token pairs against:
--   tokens   how many of those tokens traded in the last 24h — the same
--            "Trending" set as the Tokens tab's "Paired with" chips, so the
--            RWAs list's "14 tokens" matches what that link opens;
--   vol_24h  their combined 24h volume in dollars, "Most popular"'s
--            tie-breaker.
--
-- Uses the partial indexes from scripts/schema-tokens-table-indexes.sql.

CREATE OR REPLACE FUNCTION hodl_rwa_pair_stats()
RETURNS TABLE(quote_token text, tokens bigint, vol_24h double precision)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT t.quote_token,
         count(*),
         coalesce(sum(s.vol_24h) FILTER (WHERE s.vol_24h > 0 AND s.vol_at > now() - interval '24 hours'), 0)::double precision
  FROM tokens t
  JOIN token_stats s ON s.address = t.address
  WHERE t.status = 'listed' AND t.launchpad IN ('pons', 'long') AND t.eligible IS DISTINCT FROM false
    AND t.quote_kind = 'rwa' AND t.quote_token IS NOT NULL
    AND ((s.vol_24h > 0 AND s.vol_at > now() - interval '24 hours')
         OR s.price_moved_at > now() - interval '24 hours')
  GROUP BY t.quote_token
$fn$;

-- The server calls this with the service role. Nobody else needs it.
REVOKE ALL ON FUNCTION hodl_rwa_pair_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hodl_rwa_pair_stats() TO service_role;
