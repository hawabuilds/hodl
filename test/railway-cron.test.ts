import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {jobsForTick, RAILWAY_CRON_JOBS} from "../scripts/railway-cron-jobs.ts";

describe("railway cron", () => {
  it("runs prices, rewards, stats, and news every tick", () => {
    const paths = jobsForTick(7).map((job) => job.path);
    assert.ok(paths.includes("/api/cron/prices"));
    assert.ok(paths.includes("/api/cron/rewards"));
    assert.ok(paths.includes("/api/cron/stats"));
    assert.ok(paths.includes("/api/news"));
    assert.ok(!paths.includes("/api/market"));
  });

  it("warms market on the half hour", () => {
    assert.ok(jobsForTick(0).some((job) => job.path === "/api/market"));
    assert.ok(jobsForTick(30).some((job) => job.path === "/api/market"));
    assert.ok(!jobsForTick(15).some((job) => job.path === "/api/market"));
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
    const paths = RAILWAY_CRON_JOBS.map((job) => job.path).sort();
    assert.deepEqual(paths, [
      "/api/cron/prices",
      "/api/cron/rewards",
      "/api/cron/stats",
      "/api/market",
      "/api/news",
    ]);
  });
});
