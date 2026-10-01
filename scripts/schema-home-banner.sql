-- Mobile Home banner: remember that a signed-in person closed it.
--
-- Null means never closed (show the banner). Safe to run more than once.
-- Run in the Supabase SQL editor; until it runs, closing the banner is
-- remembered in the browser only and the app keeps working.

ALTER TABLE users ADD COLUMN IF NOT EXISTS home_banner_closed_at timestamptz;
