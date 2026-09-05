/**
 * Stamp tokens.eligible from stored columns (membership, not price).
 * Keyset on address. Resumable via batch_cursors.
 *
 *   npm run backfill:eligible
 */
import {normalizeAddresses} from "../src/lib/address";
import {db, hasDatabase} from "../src/lib/server/db";
import {pageByAddress, runKeysetBatch} from "../src/lib/server/live/keysetBatch";
import {writeQualifies, type TokenWrite} from "../src/lib/server/live/universeStore";

type Row = {
  address: string;
  launchpad: TokenWrite["launchpad"] | null;
  quote_kind: TokenWrite["quote_kind"];
  reward_rwa: string | null;
  bonded_at: string | null;
};

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

  const result = await runKeysetBatch<Row>({
    name: "backfill:eligible",
    loadPage: pageByAddress<Row>(
      "tokens",
      "address, launchpad, quote_kind, reward_rwa, bonded_at",
    ),
    keyOf: (row) => row.address,
    async onPage(page) {
      const yes: string[] = [];
      const no: string[] = [];
      for (const row of page) {
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
        const {error} = await db()
          .from("tokens")
          .update({eligible: true})
          .in("address", normalizeAddresses(yes));
        if (error) throw error;
      }
      if (no.length > 0) {
        const {error} = await db()
          .from("tokens")
          .update({eligible: false})
          .in("address", normalizeAddresses(no));
        if (error) throw error;
      }
      return {markedTrue: yes.length};
    },
  });

  const eligible = await count((q) => q.is("eligible", true));
  const ineligible = await count((q) => q.is("eligible", false));
  const listed = await count((q) => q.eq("status", "listed"));
  const listedEligible = await count((q) =>
    q.or("eligible.is.null,eligible.is.true").eq("status", "listed"),
  );

  console.log(
    JSON.stringify(
      {
        done: true,
        ...result,
        eligible,
        ineligible,
        listed,
        listedEligible,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
