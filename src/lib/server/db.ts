import {createClient, type SupabaseClient} from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const hasDatabase = url.length > 0 && serviceRoleKey.length > 0;

let client: SupabaseClient | null = null;

/**
 * No database request waits longer than this. PostgREST's own statement limit
 * is 8s; this also covers a gateway or connection that never answers, which
 * otherwise held a page build (and its serverless function) for minutes.
 */
const DB_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Service-role client. Bypasses row-level security, so it must only ever be
 * reached from server code that has already established who the caller is —
 * see `requireCaller` in `auth.ts`.
 */
export function db(): SupabaseClient {
  if (!hasDatabase) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  client ??= createClient(url, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false},
    // supabase-js calls the global fetch, which Next patches with its Data
    // Cache. Left alone, a PostgREST GET is cached on Vercel and survives
    // redeploys, so a row changed in Postgres keeps serving its old value with
    // no way to tell from the response that anything is stale.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const timeout = AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS);
        return fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
      },
    },
  });
  return client;
}
