/**
 * 20 no_pool rows: why PoolKey recovery called them empty.
 * Keyset on token_stats.address — no price_status index scan.
 */
import {db, hasDatabase} from "../src/lib/server/db";
import {resolveV4PoolKeysBatch} from "../src/lib/server/live/v4Pools";
import {priceTokensBatch} from "../src/lib/server/live/onchainPrice";
import type {LaunchpadId} from "../src/lib/universe";

async function main() {
  if (!hasDatabase) throw new Error("missing supabase");
  const picked: {address: string}[] = [];
  let after: string | null = null;
  while (picked.length < 20) {
    let request = db()
      .from("token_stats")
      .select("address, price_status, last_mcap, priced_at")
      .order("address", {ascending: true})
      .limit(400);
    if (after) request = request.gt("address", after);
    const {data, error} = await request;
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) break;
    after = String(page[page.length - 1]!.address);
    for (const row of page) {
      if (row.price_status === "no_pool") picked.push({address: String(row.address)});
      if (picked.length >= 20) break;
    }
  }

  const {data: tokens, error} = await db()
    .from("tokens")
    .select("address, launchpad, quote_kind, bonded_at, listed_at, status, total_supply")
    .in(
      "address",
      picked.map((row) => row.address),
    );
  if (error) throw error;
  const byAddress = new Map((tokens ?? []).map((row) => [String(row.address).toLowerCase(), row]));
  const jobs = picked.map((row) => {
    const token = byAddress.get(row.address.toLowerCase());
    return {
      address: row.address,
      launchpad: (token?.launchpad as LaunchpadId) ?? "long",
      total_supply: token?.total_supply != null ? Number(token.total_supply) : null,
      quote_kind: token?.quote_kind ?? null,
    };
  });
  const keys = await resolveV4PoolKeysBatch(jobs);
  const priced = await priceTokensBatch(jobs);
  const out = picked.map((row, i) => {
    const token = byAddress.get(row.address.toLowerCase());
    const hits = keys.get(row.address.toLowerCase()) ?? [];
    const result = priced.rows[i];
    return {
      address: row.address,
      launchpad: token?.launchpad ?? null,
      quote_kind: token?.quote_kind ?? null,
      bonded_at: token?.bonded_at ?? null,
      listed_at: token?.listed_at ?? null,
      poolKeys: hits.length,
      sources: hits.map((hit) => hit.source),
      quotes: hits.map((hit) => hit.quote),
      reprice: result?.price_status ?? null,
    };
  });
  console.log(JSON.stringify({sampled: out.length, rows: out}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
