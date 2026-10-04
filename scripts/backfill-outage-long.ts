/**
 * Index missing long-airlock Create events in outage block window via public RPC.
 * Never logs secrets.
 */
import {createPublicClient, http, parseAbiItem} from "viem";
import {robinhoodMainnet} from "../src/config/chain.ts";
import {LONG_AIRLOCK_FACTORY} from "../src/lib/contracts.ts";
import {connectAdmin, upsertTokensAdmin} from "../src/lib/server/live/adminCatalogue.ts";
import fs from "node:fs";
import pg from "pg";

function loadEnvLocal() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// Force public RPC — Chainstack free tier cannot serve historical getLogs here.
delete process.env.CHAINSTACK_RPC_URL;
delete process.env.ALCHEMY_RPC_URL;

const {indexFactory} = await import("../src/lib/server/live/tokenIndexer.ts");

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http("https://rpc.mainnet.chain.robinhood.com", {timeout: 30_000, retryCount: 0}),
});
const CREATE = parseAbiItem(
  "event Create(address asset, address indexed numeraire, address initializer, address poolOrHook)",
);

// SXY (Sep 8 01:43) → DIH (Sep 9 00:03) outage window
const from = 58023500n;
const to = 58105000n;
const chain = [];
let cursor = from;
while (cursor <= to) {
  const end = cursor + 400n - 1n > to ? to : cursor + 400n - 1n;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const batch = await client.getLogs({
        address: LONG_AIRLOCK_FACTORY.address,
        event: CREATE,
        fromBlock: cursor,
        toBlock: end,
      });
      for (const log of batch) chain.push({token: String(log.args?.asset).toLowerCase(), block: log.blockNumber});
      cursor = end + 1n;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, Math.min(4000 * 2 ** attempt, 30000)));
    }
  }
}

const raw = process.env.DATABASE_URL.trim();
const dbUrl = raw.replace(/^["']|["']$/g, "");
const pgClient = new pg.Client({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1/i.test(dbUrl) ? undefined : {rejectUnauthorized: false},
});
await pgClient.connect();
const db = await pgClient.query(
  `select lower(address) as address from tokens where lower(address) = any($1::text[])`,
  [chain.map((c) => c.token)],
);
await pgClient.end();
const have = new Set(db.rows.map((r) => r.address));
const missing = chain.filter((c) => !have.has(c.token));

console.log(JSON.stringify({chainCreates: chain.length, alreadyInDb: have.size, toIndex: missing.length}));

let upserts = 0;
const admin = await connectAdmin();
try {
  for (const item of missing) {
    const block = item.block;
    const stored = block > 30n ? block - 30n : 0n;
    const pass = await indexFactory(
      LONG_AIRLOCK_FACTORY,
      4000n,
      Date.now() + 120_000,
      "tokens:long-airlock:outage-fix",
      {
        skipImages: true,
        writeCap: 8,
        storedCursor: stored,
        untilBlock: block + 1n,
        persistWrites: async (rows) => {
          await upsertTokensAdmin(admin, rows);
        },
      },
    );
    upserts += pass.upserts;
    console.log(JSON.stringify({token: item.token, block: block.toString(), upserts: pass.upserts}));
  }
} finally {
  await admin.end().catch(() => undefined);
}

console.log(JSON.stringify({done: true, totalUpserts: upserts, attempted: missing.length}));
