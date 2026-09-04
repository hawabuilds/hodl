-- Additive migration: store the real Uniswap V3 pool, not the launchpad
-- curve / Long hook. Safe to re-run. Paste into the Supabase SQL editor.
--
-- tokens.pair_address stays populated (Pons curve / Long hook). The same
-- value is copied into launchpad_contract so the name matches what it is.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launchpad_contract text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_address text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_tier integer;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_quote_token text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_liquidity numeric;

UPDATE tokens
SET launchpad_contract = pair_address
WHERE launchpad_contract IS NULL AND pair_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS tokens_pool_address
  ON tokens (pool_address);

CREATE TABLE IF NOT EXISTS token_pools (
  token            text NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
  pool_address     text NOT NULL,
  fee_tier         integer NOT NULL,
  quote_token      text NOT NULL,
  liquidity        numeric NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token, pool_address)
);

CREATE INDEX IF NOT EXISTS token_pools_token ON token_pools (token);
