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
| `/home` | The feed. Watchlist / Tokens / RWAs tabs; New, Trending, Market cap and Rewards on the token side; sector and Market cap / Movers rails on the RWA side; search over tickers, symbols, names and contract addresses. |
| `/token/[address]` | Token chart page: pair market, transfer taxes, launchpad, contract, socials, watchlist star, chart, then Trades / Comments / Info. |
| `/rwa/[ticker]` | RWA chart page: verified tick, stock type, sector, contract, description, chart, then Trades / Comments / News. No artwork, the way a brokerage lists equities. |
| `/search` | People, tickers, token symbols and contract addresses, filterable by side. Shows the largest names on both sides before anyone types. |
| `/news` | RWA and Robinhood coverage, filtered by topic and by time, with the official Robinhood accounts pinned in as primary sources. |
| `/profile` | Your portfolio: value over 1D / 1W / 1M / 1Y / ALL, holdings split RWAs / Tokens with unrealised profit, recent orders, edit profile, settings. |
| `/u/[handle]` | Someone else: bio, socials, follow, followers and following, and their book — total value, unrealised profit, and every position, but no value line, because their entry times are not published. |

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
- **News feed** — a headline provider for the coverage on `/news`, plus the X
  API for the Robinhood accounts. Those accounts carry no post text today:
  everything else in the feed is attributed to outlets that do not exist, but
  these are real people, and inventing something for them to have said would be
  a fabricated record however clearly the feed is labelled. The cards link out
  instead.
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
`localStorage` (`src/lib/localStore.ts`). The first run opens a sample book of
four positions priced off the live feed, defined in `src/lib/sampleBook.ts`.

Every surface that shows a position says so.
