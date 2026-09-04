-- RWA — Supabase schema
--
-- Paste this into the Supabase SQL Editor and run it once.
-- Safe to re-run: tables, indexes and the seed row are created if missing.
--
-- The app talks to these tables through SUPABASE_SERVICE_ROLE_KEY
-- (src/lib/server/db.ts). That key bypasses RLS. Social tables have RLS
-- enabled with no policies so the anon key cannot read or write them.
--
-- People search stays empty until a login writes a users row via
-- POST /api/me/profile. Watchlist, orders and the simulated book stay in
-- the browser — they have no tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users ──────────────────────────────────────────────────────────
-- Primary key is the Privy DID (did:privy:...), not a UUID.

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  handle        text,
  display_name  text,
  pfp_url       text,
  bio           text,
  socials       jsonb NOT NULL DEFAULT '{}'::jsonb,
  wallet        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique
  ON users (lower(handle))
  WHERE handle IS NOT NULL;

-- ── comments ───────────────────────────────────────────────────────
-- asset_id is Asset.id: a lowercased RWA ticker or a token address.
-- The users(...) embed in social-live.ts walks comments_user_id_fkey.

CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   text NOT NULL,
  parent_id  uuid REFERENCES comments(id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (char_length(body) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_asset_id_created_at
  ON comments (asset_id, created_at);

CREATE INDEX IF NOT EXISTS comments_user_id
  ON comments (user_id);

-- ── follows ────────────────────────────────────────────────────────
-- Constraint names are load-bearing: social-live.ts selects
-- users!follows_follower_id_fkey and users!follows_following_id_fkey.

CREATE TABLE IF NOT EXISTS follows (
  follower_id  text NOT NULL,
  following_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> following_id),
  CONSTRAINT follows_follower_id_fkey
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT follows_following_id_fkey
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS follows_following_id
  ON follows (following_id);

-- ── tokens ─────────────────────────────────────────────────────────
-- Universe of Pons/Long launches. The rewards cron still writes
-- rewards_24h_usd onto these rows; it does not decide membership.

CREATE TABLE IF NOT EXISTS tokens (
  address         text PRIMARY KEY,
  rewards_24h_usd numeric(20, 2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS chain_id integer NOT NULL DEFAULT 4663;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launchpad text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS symbol text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS decimals integer NOT NULL DEFAULT 18;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS pair_address text;
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
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS indexed_at timestamptz;
-- eligible is three-state: true = show, false = hide, null = not yet
-- evaluated = show. See scripts/schema-eligible.sql. Never AND-eligible.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS eligible boolean;

CREATE INDEX IF NOT EXISTS tokens_listed_at_desc
  ON tokens (listed_at DESC, address DESC);
CREATE INDEX IF NOT EXISTS tokens_feed_listed
  ON tokens (listed_at DESC, address DESC)
  WHERE status = 'listed'
    AND launchpad IS NOT NULL
    AND eligible IS DISTINCT FROM false;
CREATE INDEX IF NOT EXISTS tokens_created_at_desc
  ON tokens (created_at DESC);
CREATE INDEX IF NOT EXISTS tokens_status
  ON tokens (status);
CREATE INDEX IF NOT EXISTS tokens_launchpad
  ON tokens (launchpad);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS tokens_name_trgm
  ON tokens USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tokens_symbol_trgm
  ON tokens USING gin (symbol gin_trgm_ops);

-- High-churn prices. A failed stats refresh must never delete a tokens row.
CREATE TABLE IF NOT EXISTS token_stats (
  address           text PRIMARY KEY REFERENCES tokens(address) ON DELETE CASCADE,
  last_price        numeric,
  last_mcap         numeric,
  liquidity_usd     numeric,
  vol_24h           numeric,
  price_change_24h  numeric,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  priced_at         timestamptz,
  price_status      text
);

ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS priced_at timestamptz;
ALTER TABLE token_stats ADD COLUMN IF NOT EXISTS price_status text;

-- ── pools (exclude from reward detection) ──────────────────────────
-- Empty is fine. The cron skips senders that appear here.

CREATE TABLE IF NOT EXISTS pools (
  address    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── reward distributions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_distributions (
  id            bigserial PRIMARY KEY,
  tx_hash       text NOT NULL UNIQUE,
  token_address text NOT NULL REFERENCES tokens(address),
  rwa_ticker    text NOT NULL,
  distributor   text NOT NULL,
  amount        numeric NOT NULL,
  amount_usd    numeric NOT NULL DEFAULT 0,
  block_number  bigint NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_distributions_occurred_at
  ON reward_distributions (occurred_at);

CREATE INDEX IF NOT EXISTS reward_distributions_token_address
  ON reward_distributions (token_address);

-- reward_distributions.token_address references tokens. A missing parent
-- is a skip, not a stub insert. See scripts/schema-eligible.sql.

-- ── indexer cursor ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indexer_state (
  name       text PRIMARY KEY,
  last_block bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO indexer_state (name, last_block)
VALUES
  ('rewards', 0),
  ('tokens:pons-v2', 27027321),
  ('tokens:pons-v1', 47234326),
  ('tokens:pons-legacy', 47227124),
  ('tokens:pons-v3', 46003341),
  ('tokens:long-airlock', 734616),
  ('tokens:long-factory', 8636038)
ON CONFLICT (name) DO NOTHING;

-- ── updated_at ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tokens_updated_at ON tokens;
CREATE TRIGGER tokens_updated_at
  BEFORE UPDATE ON tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS indexer_state_updated_at ON indexer_state;
CREATE TRIGGER indexer_state_updated_at
  BEFORE UPDATE ON indexer_state
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
-- Service role bypasses these. Anon sees nothing until policies exist.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
