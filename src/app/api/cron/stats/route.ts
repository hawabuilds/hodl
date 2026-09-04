import {json} from "@/lib/server/http";
import {decorateTokenAssets} from "@/lib/server/live/feedDecorate";
import {
  addressesForStatsWarm,
  getTokenRows,
  rowToAsset,
  statsFor,
} from "@/lib/server/live/universeStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 50;
const PAGES_PER_TICK = 8;

/**
 * Keep token_stats warm for recent listings and the current top volume
 * so the request path can paint from the store.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  const started = Date.now();
  try {
    const addresses = await addressesForStatsWarm();
    let decorated = 0;
    for (let i = 0; i < addresses.length && i / PAGE < PAGES_PER_TICK; i += PAGE) {
      const slice = addresses.slice(i, i + PAGE);
      const rows = await getTokenRows(slice);
      const stats = await statsFor(slice);
      await decorateTokenAssets(
        rows.map((row) => rowToAsset(row, stats.get(row.address.toLowerCase()))),
      );
      decorated += rows.length;
    }
    return json({
      candidates: addresses.length,
      decorated,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("stats warm failed", error);
    return json({error: String(error)}, 500);
  }
}
