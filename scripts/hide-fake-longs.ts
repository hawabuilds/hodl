/**
 * Mark existing fake Long tokens eligible=false so they leave every surface.
 *
 * Fast path: denylist + competing ba3 CREATE2 vanity (keyset, no LIKE).
 * Then tokenURI JSON for remaining visible longs that are not 1e18 vanity.
 *
 *   npm run hide:fake-longs
 */
import {normalizeAddress} from "../src/lib/address";
import {
  FAKE_LONG_EXAMPLE,
  hasCloneLongVanity,
  hasLongAppVanity,
  isDeniedFakeLong,
} from "../src/lib/longAuthenticity";
import {db, hasDatabase} from "../src/lib/server/db";
import {resolveLongAuthenticity} from "../src/lib/server/live/longAuthenticity";
import {applyThreeStateFilter} from "../src/lib/threeState";

async function markFalse(addresses: string[]): Promise<number> {
  if (addresses.length === 0) return 0;
  let marked = 0;
  for (let i = 0; i < addresses.length; i += 200) {
    const slice = addresses.slice(i, i + 200).map(normalizeAddress);
    const {error, count} = await db()
      .from("tokens")
      .update({eligible: false}, {count: "exact"})
      .eq("launchpad", "long")
      .in("address", slice);
    if (error) throw error;
    marked += count ?? slice.length;
  }
  return marked;
}

async function pageVisibleLongs(): Promise<string[]> {
  const out: string[] = [];
  let after = "";
  for (;;) {
    let request: any = applyThreeStateFilter(
      db()
        .from("tokens")
        .select("address")
        .eq("launchpad", "long")
        .order("address", {ascending: true})
        .limit(1000),
      "eligible",
    );
    if (after) request = request.gt("address", after);
    const {data, error} = await request;
    if (error) throw error;
    const rows = (data as {address: string}[]) ?? [];
    if (rows.length === 0) break;
    for (const row of rows) out.push(row.address);
    after = rows[rows.length - 1].address;
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  if (!hasDatabase) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const visible = await pageVisibleLongs();
  const vanity = visible.filter(
    (address) => isDeniedFakeLong(address) || hasCloneLongVanity(address),
  );
  const vanityHidden = await markFalse(vanity);

  const others = visible.filter(
    (address) =>
      !isDeniedFakeLong(address) &&
      !hasCloneLongVanity(address) &&
      !hasLongAppVanity(address),
  );

  let uriHidden = 0;
  let uriKept = 0;
  let uriUnknown = 0;
  const fakeFromUri: string[] = [];
  const CONCURRENCY = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < others.length) {
      const address = others[cursor++];
      const auth = await resolveLongAuthenticity(address);
      if (auth === false) fakeFromUri.push(address);
      else if (auth === true) uriKept += 1;
      else uriUnknown += 1;
    }
  }
  if (others.length > 0) {
    await Promise.all(
      Array.from({length: Math.min(CONCURRENCY, others.length)}, worker),
    );
    uriHidden = await markFalse(fakeFromUri);
  }

  const hidden = await db()
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("launchpad", "long")
    .is("eligible", false);
  if (hidden.error) throw hidden.error;

  const exampleRow = await db()
    .from("tokens")
    .select("eligible")
    .eq("address", FAKE_LONG_EXAMPLE)
    .maybeSingle();
  if (exampleRow.error) throw exampleRow.error;

  console.log(
    JSON.stringify(
      {
        vanityHidden,
        uriScanned: others.length,
        uriHidden,
        uriKept,
        uriUnknown,
        longIneligible: hidden.count ?? 0,
        exampleHidden: exampleRow.data?.eligible === false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
