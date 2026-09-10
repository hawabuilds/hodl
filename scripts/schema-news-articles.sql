-- news_articles — Finnhub wire metadata archive (Phase 2)
-- Safe to re-run. Paste into Supabase SQL Editor after schema.sql.

CREATE TABLE IF NOT EXISTS news_articles (
  id            text PRIMARY KEY,
  finnhub_id    bigint,
  headline      text NOT NULL,
  summary       text,
  url           text NOT NULL,
  source        text NOT NULL,
  image_url     text,
  published_at  timestamptz NOT NULL,
  topic         text NOT NULL CHECK (topic IN ('rwa', 'robinhood', 'market')),
  tickers       text[] NOT NULL DEFAULT '{}',
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_articles_published_at
  ON news_articles (published_at DESC);

CREATE INDEX IF NOT EXISTS news_articles_topic_published
  ON news_articles (topic, published_at DESC);

-- Service role bypasses this. Anon sees nothing — the app reads server-side only.
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

-- Retention: optional cron later —
-- DELETE FROM news_articles WHERE published_at < now() - interval '90 days';
