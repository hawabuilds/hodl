/**
 * Reconcile `src/lib/server/rwaRegistry.json` against Robinhood's own asset
 * list, the authority on what a stock token is.
 *
 * The registry is a snapshot committed to the repo, so it does not notice a
 * new listing — Pons will happily pair a launch against a stock we have never
 * heard of, and that token then has no name, no logo and no price anywhere in
 * the app. QNT (Quantinuum) sat missing this way. Robinhood publishes the
 * whole list unauthenticated, so there is no reason to find out by accident.
 *
 *   npm run rwa:check   report drift, exit 1 if the registry is behind
 *   npm run rwa:sync    rewrite the registry from the live list
 *
 * Only fields Robinhood is the authority for are written. `sector` and
 * `description` are ours — they are hand-written and must survive a sync, so
 * a new listing lands with both null and is filled in by hand afterwards.
 */
import {readFileSync, writeFileSync} from "node:fs";

const REGISTRY_PATH = "src/lib/server/rwaRegistry.json";
const ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const CHAIN_ID = 4663;

interface RegistryEntry {
  ticker: string;
  name: string;
  address: string;
  decimals: number;
  multiplier: string;
  logoUrl: string | null;
  isin: string | null;
  sector: string | null;
  stockType: string | null;
  description: string | null;
}

interface RemoteAsset {
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  currentMultiplier: string;
  logoUrl: string | null;
  isin: string | null;
  status: string;
  deployments: {contractAddress: string; chainId: number}[];
}

/** Robinhood suffixes every name; the registry stores the plain company. */
function plainName(tokenName: string): string {
  return tokenName.replace(/\s*•\s*Robinhood Token\s*$/, "").trim();
}

function addressOn4663(asset: RemoteAsset): string | null {
  const hit = (asset.deployments ?? []).find(
    (deployment) => Number(deployment.chainId) === CHAIN_ID,
  );
  return hit ? hit.contractAddress : null;
}

async function remoteAssets(): Promise<Map<string, RemoteAsset & {address: string}>> {
  const response = await fetch(ASSETS_URL, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`rhj/assets returned ${response.status}`);
  const body = (await response.json()) as {assets?: RemoteAsset[]};
  const out = new Map<string, RemoteAsset & {address: string}>();
  for (const asset of body.assets ?? []) {
    // Only live listings. A delisted asset keeps its row here until someone
    // decides what to do with the tokens already paired against it.
    if (asset.status && asset.status !== "ASSET_STATUS_ACTIVE") continue;
    const address = addressOn4663(asset);
    if (!address) continue;
    out.set(address.toLowerCase(), {...asset, address});
  }
  return out;
}

function toEntry(
  asset: RemoteAsset & {address: string},
  existing: RegistryEntry | undefined,
): RegistryEntry {
  return {
    ticker: asset.tokenSymbol,
    // A name already in the registry is kept: several were shortened by hand
    // ("IonQ", not "IonQ, Inc. Common Stock") and a sync must not undo that.
    name: existing?.name ?? plainName(asset.tokenName),
    address: asset.address,
    decimals: asset.tokenDecimals,
    multiplier: asset.currentMultiplier,
    logoUrl: asset.logoUrl ?? null,
    isin: asset.isin ?? null,
    sector: existing?.sector ?? null,
    stockType: existing?.stockType ?? null,
    description: existing?.description ?? null,
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const current = JSON.parse(raw) as RegistryEntry[];
  const byAddress = new Map(
    current.map((entry) => [entry.address.toLowerCase(), entry]),
  );

  const remote = await remoteAssets();

  const added: string[] = [];
  const delisted: string[] = [];
  const changed: string[] = [];
  /**
   * `multiplier` accrues continuously and nothing in the app reads it, so it
   * is reported but never fails the check — otherwise `rwa:check` would go
   * red every day over a field no code path touches, and stop being a signal
   * that a stock is missing.
   */
  const accrued: string[] = [];

  const next: RegistryEntry[] = [];
  for (const [address, asset] of remote) {
    const existing = byAddress.get(address);
    const entry = toEntry(asset, existing);
    if (!existing) {
      added.push(`${entry.ticker} ${entry.address}`);
    } else {
      for (const field of ["ticker", "decimals", "logoUrl", "isin"] as const) {
        if (String(existing[field] ?? "") !== String(entry[field] ?? "")) {
          changed.push(`${entry.ticker} ${field}: ${existing[field]} -> ${entry[field]}`);
        }
      }
      if (existing.multiplier !== entry.multiplier) {
        accrued.push(`${entry.ticker} ${existing.multiplier} -> ${entry.multiplier}`);
      }
    }
    next.push(entry);
  }
  for (const [address, entry] of byAddress) {
    if (remote.has(address)) continue;
    delisted.push(`${entry.ticker} ${entry.address}`);
    // Kept, not dropped: tokens may already be paired against it.
    next.push(entry);
  }

  next.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  console.log(`registry ${current.length} entries; robinhood lists ${remote.size} on chain ${CHAIN_ID}`);
  for (const line of added) console.log(`  MISSING   ${line}`);
  for (const line of changed) console.log(`  CHANGED   ${line}`);
  for (const line of delisted) console.log(`  DELISTED  ${line} (kept)`);
  if (accrued.length > 0) {
    console.log(`  ${accrued.length} multipliers have accrued (informational; no code reads them)`);
  }

  // Only a missing or misdescribed listing is a failure. Accrued multipliers
  // are still written, so `rwa:sync` does what the check tells you to run it
  // for, but they never turn the check red.
  const drifted = added.length + changed.length > 0;
  const stale = drifted || accrued.length > 0;

  if (write) {
    if (!stale) {
      console.log("registry is in sync; nothing to write");
      return;
    }
    writeFileSync(REGISTRY_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nwrote ${next.length} entries to ${REGISTRY_PATH}`);
    if (added.length > 0) {
      console.log("new entries have sector/description null — fill them in by hand");
    }
    return;
  }

  if (!drifted) {
    console.log(`registry is in sync — every listed stock is present${
      accrued.length > 0 ? " (run `npm run rwa:sync` to refresh multipliers)" : ""
    }`);
    return;
  }

  console.error(`\nregistry is behind: ${added.length} missing, ${changed.length} changed`);
  console.error("run `npm run rwa:sync` to rewrite it, then fill in sector/description by hand");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
