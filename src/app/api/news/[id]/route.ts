import {articleById} from "@/lib/server/live/news";
import {notFound, publicJson} from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One wire article from the cached feed, for the in-app reader. */
export async function GET(
  _request: Request,
  {params}: {params: {id: string}},
) {
  const id = decodeURIComponent(params.id);
  const article = await articleById(id);
  if (!article) return notFound("Article not found.");
  return publicJson({article}, {maxAge: 60, swr: 300});
}
