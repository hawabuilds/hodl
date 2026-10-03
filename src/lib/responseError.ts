/** The route's own `error` message (e.g. "Data unavailable"), else the fallback. */
export async function errorText(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {error?: unknown} | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}
