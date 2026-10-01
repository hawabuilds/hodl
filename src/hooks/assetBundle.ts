import type {Asset, AssetKind, ChartPoint, Timeframe, Trade} from "@/lib/types";

/**
 * A chart page's first load in one request.
 *
 * Opened directly (a typed link, a refresh), the page's asset, chart and
 * trades queries each fetched their own route, and the page filled in three
 * steps. The page starts this bundle before those queries run; each one takes
 * its first answer from it, so all three land together from one round trip.
 * Later refreshes go to their own routes as before.
 */
export interface AssetBundle {
  asset: Asset;
  seeded: boolean;
  chart: {
    /** The timeframe sent: the one asked for, or the page's own default. */
    timeframe?: Timeframe;
    points: ChartPoint[];
    changePct: number;
    error?: string | null;
    resolvedTimeframe?: Timeframe;
  };
  trades: {
    trades: Trade[];
    pollMs?: number;
    error?: string | null;
    liveDown?: boolean;
  };
}

/** How long a finished bundle stays claimable by the page's first queries. */
const CLAIM_MS = 1_000;

const inflight = new Map<string, {promise: Promise<AssetBundle | null>}>();

/** Without a timeframe the server sends the page's default for this asset. */
export function startAssetBundle(kind: AssetKind, key: string, timeframe?: Timeframe | null): void {
  const scope = `${kind}:${key}`;
  if (inflight.has(scope)) return;
  const query = timeframe ? `?tf=${timeframe}` : "";
  const promise = fetch(`/api/asset/${kind}/${encodeURIComponent(key)}/bundle${query}`)
    .then((res) => (res.ok ? (res.json() as Promise<AssetBundle>) : null))
    .catch(() => null);
  inflight.set(scope, {promise});
  void promise.finally(() => setTimeout(() => inflight.delete(scope), CLAIM_MS));
}

/** The bundle in flight for this asset (and timeframe, for a chart), if any. */
export async function fromAssetBundle(
  kind: AssetKind,
  key: string,
  timeframe?: Timeframe,
): Promise<AssetBundle | null> {
  const held = inflight.get(`${kind}:${key}`);
  if (!held) return null;
  const bundle = await held.promise;
  if (timeframe && bundle?.chart.timeframe && bundle.chart.timeframe !== timeframe) return null;
  return bundle;
}
