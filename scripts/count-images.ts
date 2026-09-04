/**
 * How many listed tokens have no stored image_url.
 */
import {readFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // rely on the process env
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase env missing");
  const db = createClient(url, key, {auth: {persistSession: false}});
  const listed = await db
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed");
  const imaged = await db
    .from("tokens")
    .select("address", {count: "exact", head: true})
    .eq("status", "listed")
    .not("image_url", "is", null);
  if (listed.error) {
    console.error(listed.error);
    process.exit(1);
  }
  const listedEligible = listed.count ?? 0;
  const withImage = imaged.error ? 0 : (imaged.count ?? 0);
  console.log(
    JSON.stringify(
      {
        listedEligible,
        withImage,
        missing: Math.max(0, listedEligible - withImage),
        imagedError: imaged.error?.message ?? null,
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
