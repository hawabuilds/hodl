/**
 * Railway cron runner. Add a second Railway service from this repo with
 * `railway.cron.toml`, set CRON_ORIGIN (or VERCEL_APP_URL) + CRON_SECRET,
 * and a five-minute schedule.
 *
 * Railway's minimum cron interval is five minutes, so on-chain prices refresh
 * every five minutes here instead of every minute on Vercel.
 *
 * One job timing out must not kill the process: catch, log, finish the tick,
 * exit 0 so Railway does not restart-loop before the next schedule.
 */
import {jobsForTick, type CronJob} from "./railway-cron-jobs.ts";

/** Lightest first to reduce concurrent load on the app (news → stats → prices → rewards). */
const JOB_ORDER = [
  "/api/news",
  "/api/cron/stats",
  "/api/cron/prices",
  "/api/cron/rewards",
  "/api/market",
] as const;

/**
 * Cover Vercel cron work (hobby 60s; Pro routes declare maxDuration 300).
 * 90s is enough for a healthy tick without letting one hung job eat the
 * whole five-minute Railway window. Override with CRON_JOB_TIMEOUT_MS.
 */
const JOB_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.CRON_JOB_TIMEOUT_MS ?? "90000", 10) || 90_000,
);

function sortJobsForTick(jobs: CronJob[]): CronJob[] {
  const rank = new Map(JOB_ORDER.map((path, index) => [path, index]));
  return [...jobs].sort(
    (a, b) => (rank.get(a.path) ?? JOB_ORDER.length) - (rank.get(b.path) ?? JOB_ORDER.length),
  );
}

function baseUrl(): string {
  const raw =
    process.env.CRON_ORIGIN?.trim() ||
    process.env.VERCEL_APP_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (!raw) {
    throw new Error("Set CRON_ORIGIN or VERCEL_APP_URL to the production app origin (no trailing slash)");
  }
  return raw.replace(/\/+$/, "");
}

function describeFailure(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.name === "TimeoutError" || reason.name === "AbortError") {
      return `timeout after ${JOB_TIMEOUT_MS}ms`;
    }
    return reason.message;
  }
  return String(reason);
}

async function hit(job: CronJob, origin: string): Promise<{path: string; status: number; ms: number}> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (job.auth) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) throw new Error("Set CRON_SECRET for authenticated cron routes");
    headers.authorization = `Bearer ${secret}`;
  }
  const res = await fetch(`${origin}${job.path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${job.path} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return {path: job.path, status: res.status, ms};
}

async function main(): Promise<void> {
  const minute = new Date().getUTCMinutes();
  const jobs = jobsForTick(minute);
  const origin = baseUrl();
  const ordered = sortJobsForTick(jobs);
  console.info(
    `railway-cron tick minute=${minute} origin=${origin} jobs=${ordered.map((j) => j.path).join(",")}`,
  );
  for (const job of ordered) {
    try {
      const result = await hit(job, origin);
      console.info(`railway-cron ok ${result.path} status=${result.status} ms=${result.ms}`);
    } catch (reason) {
      console.error(`railway-cron failed ${job.path} ${describeFailure(reason)}`);
    }
  }
}

main().catch((error) => {
  console.error("railway-cron crashed", error);
  process.exit(1);
});
