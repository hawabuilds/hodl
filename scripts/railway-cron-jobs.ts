export type CronJob = {
  path: string;
  auth: boolean;
  /** UTC minute filter. Omit to run on every tick. */
  when?: (minuteUtc: number) => boolean;
};

export const RAILWAY_CRON_JOBS: CronJob[] = [
  {path: "/api/cron/prices", auth: true},
  {path: "/api/cron/rewards", auth: true},
  {path: "/api/cron/stats", auth: true},
  {path: "/api/news", auth: false},
  {path: "/api/market", auth: false, when: (minute) => minute % 30 === 0},
];

export function jobsForTick(minuteUtc: number): CronJob[] {
  return RAILWAY_CRON_JOBS.filter((job) => !job.when || job.when(minuteUtc));
}
