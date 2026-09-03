import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset, fetchTrades} from "@/lib/server/sources";
import {AUTHENTICATED} from "@/lib/server/live/geckoterminal";

export const dynamic = "force-dynamic";

/** On-chain head reads need a fresh response every poll, not an edge cache. */
const LIVE_POLL_MS = 2_000;
const INDEX_POLL_MS = 12_000;

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return notFound("Unknown asset kind.");

  const {data: asset} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const {data, seeded} = await fetchTrades(asset, 300);

  // When RPC is configured the tape merges chain head fills every ~2s. Without
  // it, only the indexer runs and polling faster just hammers a stale cache.
  const pollMs =
    process.env.ALCHEMY_RPC_URL || AUTHENTICATED ? LIVE_POLL_MS : INDEX_POLL_MS;

  return json({trades: data, seeded, pollMs});
}
