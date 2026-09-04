# HODL

RWA app for trenchers on Robinhood Chain. Official tokenized stocks, plus
community tokens from **Pons** and **Long** that pair against those stocks or
pay holders in them.

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local`. Without Privy the login is faked in
the browser. With Supabase configured, the token list comes from the chain
indexer, not from DexScreener.

## What is live vs paper

| Surface | Source |
| --- | --- |
| Token list, search, New feed | Supabase `tokens`, filled by the on-chain indexer |
| RWA prices | Robinhood quotes |
| Token prices, candles, tape | DexScreener / GeckoTerminal decorate rows that already exist |
| Portfolio balances | On-chain, all connected wallets (Privy + imported) |
| Comments / profiles / follows | Supabase when configured |
| Buy / sell | Paper only — `localStorage`, no on-chain execution |
| Watchlist | `localStorage` |

The chain decides what exists. Supabase stores it. Providers only decorate it.
If every provider is down, the list still renders from Supabase without live
prices.

A token is in HODL when it was deployed by Pons or Long **and** either its
primary pool is a verified RWA or it pairs against ETH/USDG and pays holders
in an RWA. Unbonded Pons tokens are stored as `pending` and hidden. Long
launches and bonded Pons tokens are `listed`.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Privy login |
| `/home` | Watchlist / Tokens / RWAs. New is keyset-paginated from `listed_at` |
| `/token/[address]` | Token page from the store; chart and tape decorate |
| `/rwa/[ticker]` | Verified stock token |
| `/search` | RWAs, tokens, people. Address miss runs the live universe test and inserts |
| `/news` | Coverage |
| `/profile` | Holdings across embedded and imported wallets |

## Indexer

`GET /api/cron/index-tokens` (Bearer `CRON_SECRET`) walks factory logs every
minute. First fill:

```bash
npm run backfill:universe
```

Schema: `scripts/schema.sql` or the additive `scripts/schema-universe.sql`.
