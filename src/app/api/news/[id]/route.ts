import {articleById} from "@/lib/server/live/news";
import {notFound, publicJson} from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One wire article — Supabase first, then the live cache. */
export async function GET(
  _request: Request,
  context: {params: Promise<{id: string}>},
) {
  const params = await context.params;
  const id = decodeURIComponent(params.id);
  const article = await articleById(id);
  if (!article) return notFound("Article not found.");
  return publicJson({article}, {maxAge: 60, swr: 300});
}
