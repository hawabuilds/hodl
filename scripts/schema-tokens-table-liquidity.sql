-- Tokens table sort: liquidity that shows as "—" sorts last. Safe to re-run.
--
-- The table shows liquidity rounded to whole dollars, so anything under 50
-- cents reads "—" — but the sort counted it as the smallest value, and
-- "Liquidity, low to high" opened on a page of dashes. This replaces
-- hodl_token_page (same signature, same grants) so those rows go with the
-- empty ones, last, in both directions. Every other column is unchanged.
--
-- Run in the Supabase SQL editor, the whole file at once. Nothing else needs
-- to run; the indexes from scripts/schema-tokens-table-indexes.sql still apply.

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
  -- Liquidity under 50 cents shows as "—" (it rounds to $0): it counts as no
  -- value, so it sorts last with the empty rows rather than first.
  v_has text;
  v_none text;
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
  v_has := v_key || ' IS NOT NULL' || CASE WHEN p_sort = 'liq' THEN ' AND ' || v_key || ' >= 0.5' ELSE '' END;
  v_none := CASE WHEN p_sort = 'liq' THEN '(' || v_key || ' IS NULL OR ' || v_key || ' < 0.5)' ELSE v_key || ' IS NULL' END;

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
        AND %6$s
        AND ($1::text IS NULL OR t.quote_token = $1)
        %2$s
        AND ($4::text IS NULL OR %1$s %3$s $4::text::%4$s OR (%1$s = $4::text::%4$s AND t.address > $5))
      ORDER BY %1$s %5$s, t.address
      LIMIT $6
    $q$, v_key, v_extra, v_cmp, v_type, v_dir, v_has)
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
        AND %3$s
        AND ($1::text IS NULL OR t.quote_token = $1)
        %2$s
        AND ($3::text IS NULL OR t.address > $3)
      ORDER BY t.address
      LIMIT $4
    $q$, v_key, v_extra, v_none)
    USING p_quote, p_addresses,
      CASE WHEN coalesce(p_after_null, false) THEN p_after_address ELSE NULL END,
      v_limit - v_found;
  END IF;
END
$fn$;
