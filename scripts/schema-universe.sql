-- Additive migration: expand tokens into the HODL universe store.
-- Safe to re-run. Paste into the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS chain_id integer NOT NULL DEFAULT 4663;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launchpad text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS symbol text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS decimals integer NOT NULL DEFAULT 18;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pair_address text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launchpad_contract text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_address text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_tier integer;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_quote_token text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pool_liquidity numeric;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS quote_token text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS quote_kind text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS reward_rwa text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS reward_kind text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS creator text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tax_buy numeric;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tax_sell numeric;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS total_supply numeric;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS bonded_at timestamptz;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS listed_at timestamptz;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_source text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_64 text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_128 text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_color text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS indexed_at timestamptz;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_tradeable boolean;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS liquidity_usd numeric;
-- eligible / is_tradeable are three-state: true = show, false = hide,
-- null = not yet evaluated = show. Never AND-eligible / eq-true.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS eligible boolean;

CREATE INDEX IF NOT EXISTS tokens_feed_listed
  ON tokens (listed_at DESC, address DESC)
  WHERE status = 'listed'
    AND launchpad IS NOT NULL
    AND eligible IS DISTINCT FROM false;

CREATE INDEX IF NOT EXISTS tokens_listed_at_desc
  ON tokens (listed_at DESC, address DESC);
CREATE INDEX IF NOT EXISTS tokens_created_at_desc
  ON tokens (created_at DESC);
CREATE INDEX IF NOT EXISTS tokens_status ON tokens (status);
CREATE INDEX IF NOT EXISTS tokens_launchpad ON tokens (launchpad);
CREATE INDEX IF NOT EXISTS tokens_name_trgm ON tokens USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_symbol_trgm ON tokens USING gin (symbol gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_pool_address ON tokens (pool_address);
CREATE INDEX IF NOT EXISTS tokens_is_tradeable ON tokens (is_tradeable);
CREATE INDEX IF NOT EXISTS tokens_liquidity_usd ON tokens (liquidity_usd);

CREATE TABLE IF NOT EXISTS token_pools (
  token            text NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
  pool_address     text NOT NULL,
  fee_tier         integer NOT NULL,
  quote_token      text NOT NULL,
  liquidity        numeric NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token, pool_address)
);

CREATE TABLE IF NOT EXISTS token_stats (
  address           text PRIMARY KEY REFERENCES tokens(address) ON DELETE CASCADE,
  last_price        numeric,
  last_mcap         numeric,
  liquidity_usd     numeric,
  vol_24h           numeric,
  price_change_24h  numeric,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO indexer_state (name, last_block)
VALUES
  ('tokens:pons-v2', 27027321),
  ('tokens:pons-v1', 47234326),
  ('tokens:pons-legacy', 47227124),
  ('tokens:pons-v3', 46003341),
  ('tokens:long-airlock', 734616),
  ('tokens:long-factory', 8636038)
ON CONFLICT (name) DO NOTHING;
