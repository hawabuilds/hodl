import {PrivyClient} from "@privy-io/server-auth";

/**
 * Who is calling.
 *
 * Every route that writes — comments, follows, fills, watchlist — has to
 * establish identity from the access token rather than from anything in the
 * body. A user id sent by the browser is a claim, not a fact.
 */
const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const isAuthConfigured = appId.length > 0 && appSecret.length > 0;

let client: PrivyClient | null = null;

function privy(): PrivyClient {
  if (!client) client = new PrivyClient(appId, appSecret);
  return client;
}

/** The caller's Privy DID, or null when the token is missing or invalid. */
export async function callerId(request: Request): Promise<string | null> {
  if (!isAuthConfigured) return null;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  try {
    const claims = await privy().verifyAuthToken(header.slice(7));
    return claims.userId;
  } catch {
    // An unverifiable token is an anonymous caller, not an error worth raising.
    return null;
  }
}

/** The caller, or a 401 to return straight from the route. */
export async function requireCaller(
  request: Request,
): Promise<{userId: string} | Response> {
  const userId = await callerId(request);
  if (!userId) {
    return new Response(JSON.stringify({error: "Sign in to do that."}), {
      status: 401,
      headers: {"content-type": "application/json"},
    });
  }
  return {userId};
}
