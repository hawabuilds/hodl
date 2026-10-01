import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {jobsForTick, PAGE_WARM_PATHS, RAILWAY_CRON_JOBS} from "../scripts/railway-cron-jobs.ts";

describe("railway cron", () => {
  it("runs prices, rewards, stats, and every page warm-up every tick", () => {
    const paths = jobsForTick(7).map((job) => job.path);
    assert.ok(paths.includes("/api/cron/prices"));
    assert.ok(paths.includes("/api/cron/rewards"));
    assert.ok(paths.includes("/api/cron/stats"));
    for (const path of PAGE_WARM_PATHS) assert.ok(paths.includes(path), path);
  });

  it("warms pages without the cron secret", () => {
    for (const job of RAILWAY_CRON_JOBS) {
      assert.equal(job.auth, job.path.startsWith("/api/cron/"), job.path);
    }
  });

  it("vercel.json leaves crons empty (Railway owns scheduling)", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: unknown[];
    };
    assert.deepEqual(vercel.crons, []);
  });

  it("railway.cron.toml runs the cron script on a five-minute schedule", () => {
    const toml = readFileSync(join(process.cwd(), "railway.cron.toml"), "utf8");
    assert.match(toml, /cron:railway/);
    assert.match(toml, /NEVER/);
    assert.match(toml, /cronSchedule\s*=\s*"\*\/5 \* \* \* \*"/);
  });

  it("lists every migrated endpoint", () => {
    const paths = RAILWAY_CRON_JOBS.filter((job) => job.auth).map((job) => job.path).sort();
    assert.deepEqual(paths, ["/api/cron/prices", "/api/cron/rewards", "/api/cron/stats"]);
  });
});
