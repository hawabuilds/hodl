# RWA

A feed for Robinhood Chain real-world assets and the tokens whose liquidity is
paired against them. Same design system, shell and login flow as Pick.

```bash
npm install
npm run dev
```

Runs in demo mode with no configuration: login is faked in the browser, and the
market is seeded. Copy `.env.local.example` to `.env.local` and set
`NEXT_PUBLIC_PRIVY_APP_ID` for real Privy login.

## What is here

| Route | What it is |
| --- | --- |
| `/` | Privy login. Same screen and modal as Pick. |
| `/home` | Trending feed. Tokens / RWAs toggle, sector rail on the RWA side, sort chips, and search over tickers, symbols, names and contract addresses. |
| `/token/[address]` | Token chart page: launchpad link, contract, socials, watchlist star, chart, then Trades / Comments / Info. |
| `/rwa/[ticker]` | RWA chart page: verified badge, stock type, contract, description, chart, then Trades / Comments / News. |
| `/watchlist` | Everything starred, filterable by side. |
| `/profile` | Your portfolio: value, 24h line, holdings split RWAs / Tokens, recent orders, edit profile, settings. |
| `/u/[handle]` | Someone else: bio, socials, follow, followers and following, public holdings. |

## Data

Every number is seeded and deterministic — a card, the chart page it opens and
the trade list underneath all agree, and a refresh does not reshuffle the feed.
Prices move on a one-minute cadence.

`src/lib/server/sources.ts` is the seam. Each adapter documents the live source
it is waiting on and falls through to the seeded market until that source
exists. Wiring a real feed is a one-function change there, not a sweep through
the UI. Keep the seeded market afterwards as the fallback when a provider is
down, the way Pick falls back to demo data.

- **RWAs** — Robinhood Chain publishes an asset registry; pair it with the
  on-chain price feeds, as Pick does in `lib/server/rhprices.ts`. Sector, stock
  type and description are not in the registry and stay in
  `src/lib/server/universe.ts`.
- **Tokens** — enumerate pools on the chain's DEX factory, keep the ones whose
  other side is a known RWA token, then read reserves for price and liquidity.
  Launchpad attribution comes from the deployer address.
- **Charts and trades** — candles and decoded `Swap` logs for the pool.
- **News** — a headline provider keyed by ticker. Until then the route returns
  `seeded: true` and the panel labels the items as samples. Do not drop that
  flag when a real provider lands.
- **Comments, profiles and follows** — seeded server-side, with anything posted
  here written to the browser and merged in. A Supabase table like Pick's
  replaces the merge with a `POST` and nothing above the hook changes.

Launchpad links point at the reserved `.example` TLD on purpose: a link that
visibly goes nowhere is easier to find and replace than one pointing at a
plausible domain someone else owns.

## Trading

Buy and sell are fully built and validated — insufficient cash and oversized
sells fail exactly as they would against a router — but a confirmed order is
**bookkeeping only**. Nothing signs a wallet or moves funds. The book, the
watchlist, posted comments, follows and profile edits all live in
`localStorage` (`src/lib/localStore.ts`), seeded with $10,000 of simulated cash.

Every surface that shows a position says so.
