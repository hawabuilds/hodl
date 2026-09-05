import {json} from "@/lib/server/http";
import {indexTokens} from "@/lib/server/live/tokenIndexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {status: 401});
  }

  try {
    const started = Date.now();
    // One bounded live slice. History and stats are other jobs.
    // Must finish well under Vercel's 60s — 12k-block live + hist + prices did not.
    const result = await indexTokens({
      live: true,
      historical: false,
      refreshStats: false,
      skipImages: true,
      writeCap: 8,
      maxBlocks: 800n,
      budgetMs: 20_000,
    });
    const ms = Date.now() - started;
    console.info(
      `index-tokens ms=${ms} head=${result.head} upserts=${result.passes.reduce((n, p) => n + p.upserts, 0)}`,
    );
    return json({...result, ms});
  } catch (error) {
    console.error("token index failed", error);
    return json({error: String(error)}, 500);
  }
}
