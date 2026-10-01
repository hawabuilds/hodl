import {db, hasDatabase} from "@/lib/server/db";
import {publicJson} from "@/lib/server/http";
import {cachedLocal, lastBuiltAt} from "@/lib/server/live/cache";
import {readShared, SHARED_CACHE} from "@/lib/server/live/shared";

export const dynamic = "force-dynamic";

/**
 * What /health shows: how fast the database and Redis answer right now, how
 * old each page's saved copy is, and whether the background jobs are keeping
 * up. Cheap by design — one one-row read, one Redis round trip, one small
 * table read — and shared for 5s, so watching it cannot add load.
 */

/** Page caches worth watching: the ones every visitor's first screen reads. */
/** `onDemand`: rebuilt only when someone uses it (search), so its age says nothing about health. */
const PAGES: {label: string; key: string; staleAfterS: number; onDemand?: boolean}[] = [
  {label: "Market · trending", key: "page:market:sort=trending", staleAfterS: 600},
  {label: "Market · volume", key: "page:market:sort=volume", staleAfterS: 600},
  {label: "New listings", key: "page:tokens-new:limit=50", staleAfterS: 600},
  {label: "Tokens table · trending", key: "page:tokens-table:dir=desc&sort=vol&tab=trending", staleAfterS: 600},
  {label: "Tokens table · new", key: "page:tokens-table:dir=desc&sort=age&tab=new", staleAfterS: 600},
  {label: "News", key: "page:news-feed", staleAfterS: 900},
  {label: "RWAs overview", key: "page:rwas-overview", staleAfterS: 600},
  {label: "RWAs list", key: "page:rwas-list:category=all&offset=0&sort=popular", staleAfterS: 600},
  {label: "Search index", key: "market:search-index", staleAfterS: 1800, onDemand: true},
];

async function timed<T>(load: () => Promise<T>): Promise<{ms: number; ok: boolean; value: T | null}> {
  const started = Date.now();
  try {
    const value = await load();
    return {ms: Date.now() - started, ok: true, value};
  } catch {
    return {ms: Date.now() - started, ok: false, value: null};
  }
}

async function check() {
  const now = Date.now();
  const [database, redis, built, jobs] = await Promise.all([
    timed(async () => {
      if (!hasDatabase) throw new Error("no database");
      const {error} = await db().from("indexer_state").select("name").limit(1);
      if (error) throw error;
      return true;
    }),
    timed(async () => {
      if (!SHARED_CACHE) throw new Error("no redis");
      await readShared("health:ping");
      return true;
    }),
    lastBuiltAt(PAGES.map((page) => page.key)).catch(() => new Map<string, number>()),
    timed(async () => {
      const {data, error} = await db()
        .from("indexer_state")
        .select("name, updated_at, last_run_at, blocks_behind")
        .in("name", ["live-tip", "price-refresh:dormant", "rewards"]);
      if (error) throw error;
      return data as {name: string; updated_at: string | null; last_run_at: string | null; blocks_behind: number | null}[];
    }),
  ]);

  const row = (name: string) => jobs.value?.find((job) => job.name === name);
  const ageS = (iso: string | null | undefined) =>
    iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
  const tip = row("live-tip");
  const pages = PAGES.map((page) => {
    const at = built.get(page.key);
    const age = at ? Math.max(0, Math.round((now - at) / 1000)) : null;
    const ok = page.onDemand ? true : age != null && age <= page.staleAfterS;
    return {label: page.label, ageS: age, ok};
  });
  const indexer = {
    heartbeatAgeS: ageS(tip?.last_run_at ?? tip?.updated_at),
    blocksBehind: tip?.blocks_behind ?? null,
  };
  const pricesAgeS = ageS(row("price-refresh:dormant")?.updated_at);
  const rewardsAgeS = ageS(row("rewards")?.updated_at);

  const problems = [
    !database.ok ? "Database not answering" : database.ms > 1_000 ? `Database slow (${database.ms}ms)` : null,
    !redis.ok ? "Redis not answering" : null,
    indexer.heartbeatAgeS == null || indexer.heartbeatAgeS > 120 ? "Indexer heartbeat stale" : null,
    pricesAgeS == null || pricesAgeS > 900 ? "Prices job stale" : null,
    ...pages.filter((page) => !page.ok).map((page) => `${page.label} cache stale`),
  ].filter((problem): problem is string => problem != null);

  return {
    status: problems.length === 0 ? "ok" : "degraded",
    problems,
    checkedAt: new Date(now).toISOString(),
    database: {ms: database.ms, ok: database.ok},
    redis: {ms: redis.ms, ok: redis.ok},
    indexer,
    jobs: {pricesAgeS, rewardsAgeS},
    pages,
  };
}

export async function GET() {
  const body = await cachedLocal("health", 5_000, check);
  return publicJson(body, {maxAge: 5, swr: 5});
}
