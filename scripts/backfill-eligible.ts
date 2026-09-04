/**
 * Stamp tokens.eligible from stored columns, then report counts.
 * Requires scripts/schema-eligible.sql (the column). Safe to re-run.
 *
 *   node --import ./test/resolver.mjs --env-file=.env.local scripts/backfill-eligible.ts
 */
import {normalizeAddresses} from "../src/lib/address";
import {db, hasDatabase} from "../src/lib/server/db";
import {writeQualifies, type TokenWrite} from "../src/lib/server/live/universeStore";

async function count(apply: (q: any) => any) {
  const {count, error} = await apply(
    db().from("tokens").select("address", {count: "exact", head: true}),
  );
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  if (!hasDatabase) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  const probe = await db().from("tokens").select("eligible").limit(1);
  if (probe.error && /eligible/i.test(probe.error.message)) {
    throw new Error("tokens.eligible missing — paste scripts/schema-eligible.sql first");
  }

  let last: string | null = null;
  let scanned = 0;
  let markedTrue = 0;
  for (;;) {
    let request = db()
      .from("tokens")
      .select("address, launchpad, quote_kind, reward_rwa, bonded_at")
      .order("address", {ascending: true})
      .limit(500);
    if (last) request = request.gt("address", last);
    const {data, error} = await request;
    if (error) throw error;
    const rows = (data ?? []) as {
      address: string;
      launchpad: TokenWrite["launchpad"] | null;
      quote_kind: TokenWrite["quote_kind"];
      reward_rwa: string | null;
      bonded_at: string | null;
    }[];
    if (rows.length === 0) break;
    last = rows[rows.length - 1]!.address;
    scanned += rows.length;

    const yes: string[] = [];
    const no: string[] = [];
    for (const row of rows) {
      const ok =
        row.launchpad === "pons" || row.launchpad === "long"
          ? writeQualifies({
              launchpad: row.launchpad,
              quote_kind: row.quote_kind,
              reward_rwa: row.reward_rwa,
              bonded_at: row.bonded_at,
            })
          : false;
      if (ok) yes.push(row.address);
      else no.push(row.address);
    }
    if (yes.length > 0) {
      const {error: err} = await db()
        .from("tokens")
        .update({eligible: true})
        .in("address", normalizeAddresses(yes));
      if (err) throw err;
      markedTrue += yes.length;
    }
    if (no.length > 0) {
      const {error: err} = await db()
        .from("tokens")
        .update({eligible: false})
        .in("address", normalizeAddresses(no));
      if (err) throw err;
    }
    console.log(JSON.stringify({scanned, markedTrue}));
  }

  const eligible = await count((q) => q.is("eligible", true));
  const ineligible = await count((q) => q.is("eligible", false));
  const listedEligible = await count((q) =>
    q.is("eligible", true).eq("status", "listed").not("quote_kind", "is", null),
  );

  console.log(
    JSON.stringify(
      {done: true, scanned, markedTrue, eligible, ineligible, listedEligible},
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
