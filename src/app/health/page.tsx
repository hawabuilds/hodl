"use client";

import {useEffect, useState} from "react";

/**
 * The site's vital signs, for spotting trouble before users do: database and
 * Redis response times, the age of each page's saved copy, and whether the
 * indexer and price jobs are keeping up. Reads /api/health every 10s.
 */
interface Health {
  status: "ok" | "degraded";
  problems: string[];
  checkedAt: string;
  database: {ms: number; ok: boolean};
  redis: {ms: number; ok: boolean};
  indexer: {heartbeatAgeS: number | null; blocksBehind: number | null};
  jobs: {pricesAgeS: number | null; rewardsAgeS: number | null};
  pages: {label: string; ageS: number | null; ok: boolean}[];
}

function age(seconds: number | null): string {
  if (seconds == null) return "never";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function Row({label, value, ok}: {label: string; value: string; ok: boolean}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--overlay-wash)] py-2.5 text-[14px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2 font-semibold tabular-nums">
        {value}
        <span
          aria-label={ok ? "ok" : "problem"}
          className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-price-up" : "bg-price-down"}`}
        />
      </span>
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/health", {cache: "no-store"});
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Health;
        if (live) {
          setHealth(body);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    };
    void load();
    const id = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-[640px] bg-surface-base px-4 py-10">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">HODL health</h1>
      {failed && !health ? (
        <p className="mt-6 font-semibold text-price-down">The health check itself is not answering.</p>
      ) : !health ? (
        <p className="mt-6 text-faint">Checking…</p>
      ) : (
        <>
          <p className={`mt-2 text-[15px] font-bold ${health.status === "ok" ? "text-price-up" : "text-price-down"}`}>
            {health.status === "ok" ? "All good" : health.problems.join(" · ")}
          </p>
          <p className="mt-1 text-[12px] text-faint">
            Checked {new Date(health.checkedAt).toLocaleTimeString()} · refreshes every 10s
            {failed ? " · last refresh failed" : ""}
          </p>

          <h2 className="mt-8 text-[13px] font-bold uppercase tracking-wide text-faint">Response times</h2>
          <Row
            label="Database"
            value={health.database.ok ? `${health.database.ms}ms` : "not answering"}
            ok={health.database.ok && health.database.ms <= 1_000}
          />
          <Row label="Redis" value={health.redis.ok ? `${health.redis.ms}ms` : "not answering"} ok={health.redis.ok} />

          <h2 className="mt-8 text-[13px] font-bold uppercase tracking-wide text-faint">Background jobs</h2>
          <Row
            label="Indexer heartbeat"
            value={`${age(health.indexer.heartbeatAgeS)}${health.indexer.blocksBehind != null ? ` · ${health.indexer.blocksBehind} blocks behind` : ""}`}
            ok={health.indexer.heartbeatAgeS != null && health.indexer.heartbeatAgeS <= 120}
          />
          <Row
            label="Prices job"
            value={age(health.jobs.pricesAgeS)}
            ok={health.jobs.pricesAgeS != null && health.jobs.pricesAgeS <= 900}
          />
          <Row
            label="Rewards job"
            value={age(health.jobs.rewardsAgeS)}
            ok={health.jobs.rewardsAgeS != null && health.jobs.rewardsAgeS <= 900}
          />

          <h2 className="mt-8 text-[13px] font-bold uppercase tracking-wide text-faint">Page caches (last good build)</h2>
          {health.pages.map((page) => (
            <Row key={page.label} label={page.label} value={age(page.ageS)} ok={page.ok} />
          ))}
        </>
      )}
    </main>
  );
}
