-- Run only if the UPDATE in schema-eligible.sql hits 57014 (statement timeout).
-- ALTER and the index will already have landed. Safe to re-run; each batch
-- only touches rows that are still null.

UPDATE tokens
SET eligible = CASE
  WHEN launchpad IS NULL THEN false
  WHEN quote_kind IS NULL THEN false
  WHEN quote_kind = 'rwa' THEN true
  WHEN quote_kind IN ('eth', 'usdg') AND reward_rwa IS NOT NULL THEN true
  ELSE false
END
WHERE eligible IS NULL
  AND address IN (
    SELECT address FROM tokens
    WHERE eligible IS NULL
    ORDER BY address
    LIMIT 20000
  );
