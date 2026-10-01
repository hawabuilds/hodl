export type CronJob = {
  path: string;
  auth: boolean;
  /** UTC minute filter. Omit to run on every tick. */
  when?: (minuteUtc: number) => boolean;
};

export const PAGE_WARM_PATHS = [
  "/api/news?window=latest&topic=all",
  "/api/market?sort=trending",
  "/api/market?sort=volume",
  "/api/tokens/new?limit=50",
  "/api/tokens/table?tab=trending&sort=vol&dir=desc",
  "/api/tokens/table?tab=new&sort=age&dir=desc",
  "/api/rwas/overview",
  "/api/rwas/list?category=all&sort=popular&offset=0",
  "/api/home",
];

export const RAILWAY_CRON_JOBS: CronJob[] = [
  {path: "/api/cron/prices", auth: true},
  {path: "/api/cron/rewards", auth: true},
  {path: "/api/cron/stats", auth: true},
  {path: "/api/cron/sparks", auth: true},
  // The public page routes, at exactly the URLs the site requests, so each
  // page's cache and its last good copy are rebuilt here rather than by a
  // visitor after a deploy or a quiet spell.
  ...PAGE_WARM_PATHS.map((path) => ({path, auth: false})),
];

export function jobsForTick(minuteUtc: number): CronJob[] {
  return RAILWAY_CRON_JOBS.filter((job) => !job.when || job.when(minuteUtc));
}
