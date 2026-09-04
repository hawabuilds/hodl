import {json, notFound, parseKind} from "@/lib/server/http";
import {fetchAsset, fetchTrades} from "@/lib/server/sources";

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

  const {data: asset, seeded: assetIsSeeded} = await fetchAsset(kind, params.id);
  if (!asset) return notFound("No asset with that id.");

  const {data, seeded, error} = await fetchTrades(asset, 300, assetIsSeeded);

  // Tape cadence follows Alchemy, not CoinGecko. Gecko is optional history.
  const pollMs = process.env.ALCHEMY_RPC_URL ? LIVE_POLL_MS : INDEX_POLL_MS;

  return json({trades: data, seeded, pollMs, error: error ?? null});
}
