-- Desktop Tokens table. Safe to re-run. Run this file first, then
-- scripts/schema-tokens-table-indexes.sql (one statement at a time).

-- ── token_stats: DexScreener buys / sells, and when volume was measured ──
-- buys_24h / sells_24h: DexScreener's 24h transaction counts for the token's
-- deepest pair, saved so the table can sort by them. Null = DexScreener had no
-- data, shown as "—".
-- vol_at: when vol_24h (and the counts) were last measured. The price job
-- re-saves vol_24h as it was, so updated_at says nothing about how old the
-- volume is; this does.
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS buys_24h integer;
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS sells_24h integer;
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS vol_at timestamptz;
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS txns_24h integer
  GENERATED ALWAYS AS (buys_24h + sells_24h) STORED;

-- ── users: quick buy amount ─────────────────────────────────────────────
-- Dollars per quick buy from the Tokens table. Null = the default ($25).
ALTER TABLE users ADD COLUMN IF NOT EXISTS quick_buy_usd numeric(12, 2);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_quick_buy_usd_positive;
ALTER TABLE users ADD CONSTRAINT users_quick_buy_usd_positive
  CHECK (quick_buy_usd IS NULL OR quick_buy_usd > 0);

-- ── One page of the Tokens table ────────────────────────────────────────
-- The universe is every listed Pons / Long token that is not ruled ineligible
-- (three-state: eligible IS DISTINCT FROM false). Trending narrows it to tokens
-- that traded in the last 24h: DexScreener volume measured in that window, or
-- a pool price that moved (only a swap moves it). 'set' narrows it to the
-- given addresses (Watchlist, Following).
--
-- Pages are keyset, not offset: each continues from the last row's value and
-- address, so page 40 costs what page 1 does. Rows with a value come first in
-- the chosen order; rows with none come after, by address, in a second phase.
-- The universe predicate is written exactly as the partial indexes' predicate
-- so the planner can use them.
DROP FUNCTION IF EXISTS hodl_token_page(text, text, boolean, text, text[], double precision, text, boolean, integer);
CREATE OR REPLACE FUNCTION hodl_token_page(
  p_universe text,
  p_sort text,
  p_desc boolean,
  p_quote text DEFAULT NULL,
  p_addresses text[] DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_address text DEFAULT NULL,
  p_after_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
) RETURNS TABLE(address text, sort_key text)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $fn$
DECLARE
  v_key text;
  v_type text;
  v_dir text := CASE WHEN p_desc THEN 'DESC' ELSE 'ASC' END;
  v_cmp text := CASE WHEN p_desc THEN '<' ELSE '>' END;
  v_extra text := '';
  v_found integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  -- The cursor carries the last row's value as exact text and is cast back to
  -- the column's own type: a float in between rounds numeric values, and the
  -- page after a rounded value repeats or skips rows.
  CASE p_sort
    WHEN 'age' THEN v_key := 't.listed_at';
      SELECT format_type(atttypid, atttypmod) INTO v_type FROM pg_attribute
        WHERE attrelid = 'tokens'::regclass AND attname = 'listed_at';
    WHEN 'mcap', 'change', 'liq', 'vol', 'txns' THEN
      v_key := 's.' || CASE p_sort
        WHEN 'mcap' THEN 'last_mcap' WHEN 'change' THEN 'price_change_24h'
        WHEN 'liq' THEN 'liquidity_usd' WHEN 'vol' THEN 'vol_24h' ELSE 'txns_24h' END;
      SELECT format_type(atttypid, atttypmod) INTO v_type FROM pg_attribute
        WHERE attrelid = 'token_stats'::regclass AND attname = substr(v_key, 3);
    ELSE RAISE EXCEPTION 'unknown sort %', p_sort;
  END CASE;

  IF p_universe = 'trending' THEN
    v_extra := $x$ AND ((s.vol_24h > 0 AND s.vol_at > now() - interval '24 hours')
                     OR s.price_moved_at > now() - interval '24 hours') $x$;
  ELSIF p_universe = 'set' THEN
    v_extra := ' AND t.address = ANY($2) ';
  ELSIF p_universe <> 'new' THEN
    RAISE EXCEPTION 'unknown universe %', p_universe;
  END IF;

  -- Phase 1: rows with a value, in order.
  IF NOT coalesce(p_after_null, false) THEN
    RETURN QUERY EXECUTE format($q$
      SELECT t.address, %1$s::text
      FROM tokens t
      LEFT JOIN token_stats s ON s.address = t.address
      WHERE t.status = 'listed' AND t.launchpad IN ('pons', 'long') AND t.eligible IS DISTINCT FROM false
        AND %1$s IS NOT NULL
        AND ($1::text IS NULL OR t.quote_token = $1)
        %2$s
        AND ($4::text IS NULL OR %1$s %3$s $4::text::%4$s OR (%1$s = $4::text::%4$s AND t.address > $5))
      ORDER BY %1$s %5$s, t.address
      LIMIT $6
    $q$, v_key, v_extra, v_cmp, v_type, v_dir)
    USING p_quote, p_addresses, p_universe, p_after_key, coalesce(p_after_address, ''), v_limit;
    GET DIAGNOSTICS v_found = ROW_COUNT;
  END IF;

  -- Phase 2: rows with no value, last, by address.
  IF v_found < v_limit THEN
    RETURN QUERY EXECUTE format($q$
      SELECT t.address, NULL::text
      FROM tokens t
      LEFT JOIN token_stats s ON s.address = t.address
      WHERE t.status = 'listed' AND t.launchpad IN ('pons', 'long') AND t.eligible IS DISTINCT FROM false
        AND %1$s IS NULL
        AND ($1::text IS NULL OR t.quote_token = $1)
        %2$s
        AND ($3::text IS NULL OR t.address > $3)
      ORDER BY t.address
      LIMIT $4
    $q$, v_key, v_extra)
    USING p_quote, p_addresses,
      CASE WHEN coalesce(p_after_null, false) THEN p_after_address ELSE NULL END,
      v_limit - v_found;
  END IF;
END
$fn$;

-- ── "Paired with" counts for one tab ────────────────────────────────────
CREATE OR REPLACE FUNCTION hodl_token_pairs(
  p_universe text,
  p_addresses text[] DEFAULT NULL
) RETURNS TABLE(quote_token text, tokens bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT t.quote_token, count(*)
  FROM tokens t
  LEFT JOIN token_stats s ON s.address = t.address
  WHERE t.status = 'listed' AND t.launchpad IN ('pons', 'long') AND t.eligible IS DISTINCT FROM false
    AND t.quote_kind = 'rwa' AND t.quote_token IS NOT NULL
    AND (p_universe <> 'set' OR t.address = ANY(p_addresses))
    AND (p_universe <> 'trending'
         OR (s.vol_24h > 0 AND s.vol_at > now() - interval '24 hours')
         OR s.price_moved_at > now() - interval '24 hours')
  GROUP BY t.quote_token
  ORDER BY count(*) DESC, t.quote_token
$fn$;

-- The server calls these with the service role. Nobody else needs them.
REVOKE ALL ON FUNCTION hodl_token_page(text, text, boolean, text, text[], text, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hodl_token_pairs(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hodl_token_page(text, text, boolean, text, text[], text, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION hodl_token_pairs(text, text[]) TO service_role;
