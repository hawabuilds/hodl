import type {
  Asset,
  AssetComment,
  Holding,
  Profile,
  SocialLinks,
} from "@/lib/types";
import {between, fakeAddress, pick, rng} from "./rng";
import {listRwas, listTokens} from "./market";

/**
 * People.
 *
 * Seeded the same way the market is: a fixed cast with stable handles, so a
 * comment author always resolves to the same profile and a follower count does
 * not jump between renders.
 *
 * Demo only: served when DEMO_MODE=1 and no database is configured
 * (`demoMode.ts`). The live app reads the Supabase `users` and `follows`
 * tables through `social-live.ts`.
 */

interface PersonaSeed {
  handle: string;
  displayName: string;
  bio: string;
}

const PERSONAS: PersonaSeed[] = [
  {handle: "wafercycle", displayName: "Wafer", bio: "Semis only. I read the capex tables so you don't have to."},
  {handle: "0xmargin", displayName: "Margin", bio: "Liquidity provider. Mostly paired against ETFs."},
  {handle: "basisrisk", displayName: "Basis", bio: "Arbing the gap between the wrapper and the ticker."},
  {handle: "nightdesk", displayName: "Night Desk", bio: "24/7 markets mean I never sleep. Posting through it."},
  {handle: "tapereader", displayName: "Tape", bio: "Prints over narratives. Screenshots in the replies."},
  {handle: "coolantco", displayName: "Coolant", bio: "Data centre power and thermals. Long the boring layer."},
  {handle: "smallmods", displayName: "Small Mods", bio: "SMR believer since before it was a sector."},
  {handle: "floatcheck", displayName: "Float Check", bio: "Supply schedules, unlocks, and who is actually selling."},
  {handle: "greenlot", displayName: "Green Lot", bio: "Buying dips in things with real revenue."},
  {handle: "poolwatch", displayName: "Pool Watch", bio: "Watching LP depth so you can size properly."},
  {handle: "quantumleap", displayName: "Leap", bio: "Qubit counts are marketing. Error rates are the trade."},
  {handle: "steadyhand", displayName: "Steady", bio: "Boring index exposure and one bad meme position."},
];

function socialsFor(handle: string): SocialLinks {
  return {
    x: `https://x.com/${handle}`,
    telegram: null,
    website: null,
    discord: null,
  };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const ROOT_TEMPLATES = [
  "Sizing this against {paired} rather than dollars. The pair is the whole thesis.",
  "Depth on the pool got noticeably better this week. Slippage on a $5k clip is finally sane.",
  "I keep buying every time it retests the level it broke out from. No plans to stop.",
  "Nothing has changed fundamentally. The chart is just doing chart things.",
  "The 24/7 market is the underrated part here — the gap risk everyone worries about mostly is not real.",
  "Trimmed a third into strength. Still holding the rest into the next print.",
  "Watching the LP depth more than the price. If that thins out I am gone.",
  "This is my largest position and I am not comfortable, which is usually a good sign.",
  "Reminder that the wrapper and the underlying can and do diverge intraday.",
  "Been accumulating quietly for three weeks. Posting so I have something to be wrong about publicly.",
];

const REPLY_TEMPLATES = [
  "Agree on the direction, disagree on the size.",
  "What level are you adding at?",
  "This aged well.",
  "The pool depth argument is the only one that matters to me here.",
  "Been in since launch. Same read.",
  "Respectfully, no. The supply schedule says otherwise.",
  "Saving this to check in a month.",
];

function personaFor(next: () => number): PersonaSeed {
  return pick(next, PERSONAS);
}

/**
 * Seeded discussion for an asset, oldest first.
 *
 * Bucketed by the hour so the thread grows over a session rather than churning
 * on every request, and so timestamps stay meaningful.
 */
export function commentsFor(asset: Asset, now: number = Date.now()): AssetComment[] {
  const paired = asset.kind === "token" ? asset.pairedTicker : asset.ticker;
  const next = rng(`comments:${asset.id}`);
  const rootCount = 2 + Math.floor(next() * 4);

  const out: AssetComment[] = [];
  let at = now - between(next, 8, 96) * 3_600_000;

  for (let i = 0; i < rootCount; i++) {
    const author = personaFor(next);
    const rootId = `${asset.id}-c${i}`;
    out.push({
      id: rootId,
      assetId: asset.id,
      parentId: null,
      author: {
        handle: author.handle,
        displayName: author.displayName,
        pfpUrl: null,
      },
      body: pick(next, ROOT_TEMPLATES).replaceAll("{paired}", paired),
      createdAt: new Date(Math.round(at)).toISOString(),
      likes: 0,
      liked: false,
      position: null,
    });

    const replies = next() < 0.55 ? 1 + Math.floor(next() * 2) : 0;
    let replyAt = at;
    for (let r = 0; r < replies; r++) {
      replyAt += between(next, 0.2, 6) * 3_600_000;
      if (replyAt > now) break;
      const replier = personaFor(next);
      out.push({
        id: `${rootId}-r${r}`,
        assetId: asset.id,
        parentId: rootId,
        author: {
          handle: replier.handle,
          displayName: replier.displayName,
          pfpUrl: null,
        },
        body: pick(next, REPLY_TEMPLATES),
        createdAt: new Date(Math.round(replyAt)).toISOString(),
        likes: 0,
        liked: false,
        position: null,
      });
    }

    at += between(next, 1, 14) * 3_600_000;
    if (at > now) at = now - between(next, 0.1, 2) * 3_600_000;
  }

  return out.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function holdingsFor(handle: string, now: number): Holding[] {
  const next = rng(`book:${handle}`);
  const rwas = listRwas(now);
  const tokens = listTokens(now);

  const rwaCount = 2 + Math.floor(next() * 4);
  const tokenCount = 1 + Math.floor(next() * 4);
  const out: Holding[] = [];
  const taken = new Set<string>();

  for (let i = 0; i < rwaCount; i++) {
    const asset = pick(next, rwas);
    if (taken.has(asset.id)) continue;
    taken.add(asset.id);
    const amount = Number(between(next, 0.4, 180).toFixed(4));
    // Entry is drawn relative to the current price, so a public book shows a
    // realistic spread of winners and losers rather than all-green.
    const entry = asset.priceUsd * between(next, 0.55, 1.35);
    out.push({
      kind: "rwa",
      assetId: asset.id,
      symbol: asset.ticker,
      name: asset.name,
      logoUrl: asset.logoUrl,
      amount,
      valueUsd: Number((amount * asset.priceUsd).toFixed(2)),
      changePct: asset.changePct,
      costUsd: Number((amount * entry).toFixed(2)),
    });
  }

  for (let i = 0; i < tokenCount; i++) {
    const asset = pick(next, tokens);
    if (taken.has(asset.id)) continue;
    taken.add(asset.id);
    if (asset.priceUsd == null || asset.priceUsd <= 0) continue;
    const amount = Math.round(between(next, 50_000, 40_000_000));
    const entry = asset.priceUsd * between(next, 0.3, 2.1);
    out.push({
      kind: "token",
      assetId: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.imageUrl,
      amount,
      valueUsd: Number((amount * asset.priceUsd).toFixed(2)),
      changePct: asset.changePct,
      costUsd: Number((amount * entry).toFixed(2)),
    });
  }

  return out.sort((a, b) => b.valueUsd - a.valueUsd);
}

export function getProfile(
  handle: string,
  now: number = Date.now(),
): Profile | null {
  const wanted = handle.replace(/^@/, "").toLowerCase();
  const seed = PERSONAS.find((p) => p.handle === wanted);
  if (!seed) return null;

  const next = rng(`profile:${seed.handle}`);
  return {
    handle: seed.handle,
    displayName: seed.displayName,
    pfpUrl: null,
    bio: seed.bio,
    socials: socialsFor(seed.handle),
    wallet: fakeAddress(`wallet:${seed.handle}`),
    followers: Math.round(between(next, 40, 24_000)),
    following: Math.round(between(next, 20, 900)),
    holdings: holdingsFor(seed.handle, now),
  };
}

/** Handles that follow, or are followed by, someone. Seeded from the cast. */
export function connectionsFor(
  handle: string,
  kind: "followers" | "following",
): Profile["handle"][] {
  const next = rng(`${kind}:${handle}`);
  return PERSONAS.filter((p) => p.handle !== handle)
    .filter(() => next() < 0.55)
    .map((p) => p.handle);
}

export function listPersonas(): {handle: string; displayName: string}[] {
  return PERSONAS.map(({handle, displayName}) => ({handle, displayName}));
}

/**
 * People matching a query, handle-first.
 *
 * An empty query returns the whole cast rather than nothing: the search tab
 * uses it to show who is here before anyone has typed.
 */
export function searchPeople(query: string, now: number = Date.now()): Profile[] {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  const matches = PERSONAS.filter(
    (persona) =>
      q.length === 0 ||
      persona.handle.includes(q) ||
      persona.displayName.toLowerCase().includes(q),
  );

  return matches
    .map((persona) => getProfile(persona.handle, now))
    .filter((profile): profile is Profile => profile !== null);
}
