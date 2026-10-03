-- Removes portfolio chart points that were saved while a holding's price was
-- missing and counted as $0 (fixed in the portfolio price-state PR: points
-- are no longer saved while any price is missing).
--
-- Wallet 0xa16ceb5857f880d86b35309fbf9ac021644b6516 (@nanditoisking) held NVDA
-- from 2026-10-03 08:56 UTC, but two snapshots after that recorded $0 in
-- positions — only the ETH balance — which is the drop at the end of the chart:
--
--   2026-10-03 09:22:42 UTC  total $94.90   positions $0  (NVDA ~0.106, ~$24.7)
--   2026-10-03 13:20:26 UTC  total $44.75   positions $0  (NVDA ~0.318, ~$74)
--
-- The other $0-position rows for this wallet are real (before its first trade,
-- or after everything was sold on 2026-10-02 20:52 UTC) and are kept.
--
-- Run in the Supabase SQL editor. Step 1 previews; step 2 deletes.

-- 1. Preview: should return exactly these 2 rows.
SELECT id, wallet, captured_at, total_usd, positions_usd, eth_usd
FROM portfolio_snapshots
WHERE wallet = '0xa16ceb5857f880d86b35309fbf9ac021644b6516'
  AND positions_usd = 0
  AND captured_at IN ('2026-10-03 09:22:42.862+00', '2026-10-03 13:20:26.64+00');

-- 2. Delete them.
DELETE FROM portfolio_snapshots
WHERE wallet = '0xa16ceb5857f880d86b35309fbf9ac021644b6516'
  AND positions_usd = 0
  AND captured_at IN ('2026-10-03 09:22:42.862+00', '2026-10-03 13:20:26.64+00');
