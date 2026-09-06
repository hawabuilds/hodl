import type {AssetComment, Profile} from "@/lib/types";
import {fallbackHandle, handleIlike, normalizeHandle} from "@/lib/handle";
import {db, hasDatabase} from "./db";

/** People returned for one query. Twenty was a silent ceiling on the tab. */
const SEARCH_USER_LIMIT = 40;

/**
 * People and conversation, from Postgres.
 *
 * Every function here returns empty rather than throwing when the database is
 * unconfigured, so the callers can fall through to the seeded cast without
 * special-casing the outage.
 */

interface UserRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  bio: string | null;
  socials: Record<string, string | null> | null;
  wallet: string | null;
}

/** What a comment join brings back — a subset of the user row. */
type CommentAuthor = Pick<UserRow, "handle" | "display_name" | "pfp_url">;

/** PostgREST returns a joined row as an object or a single-element array. */
function one<T>(value: T | T[] | undefined | null): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function toProfile(row: UserRow, followers = 0, following = 0): Profile {
  return {
    handle: row.handle ?? row.id.slice(-8),
    displayName: row.display_name ?? row.handle ?? "Trader",
    pfpUrl: row.pfp_url,
    bio: row.bio ?? "",
    socials: {
      x: row.socials?.x ?? null,
      telegram: row.socials?.telegram ?? null,
      website: row.socials?.website ?? null,
      discord: row.socials?.discord ?? null,
    },
    // Never sent. A profile is public; the address that ties a handle to every
    // trade the person has ever made is not, and it only has to leak once. The
    // owner reads their own from their session, and the server uses
    // `walletForHandle` where it needs one to price holdings.
    wallet: null,
    followers,
    following,
    holdings: [],
  };
}

/**
 * The address behind a handle, for server-side use only.
 *
 * Kept apart from `toProfile` so that a wallet can only reach a response by
 * someone deciding to put it there.
 */
export async function walletForHandle(
  handle: string,
): Promise<string | null> {
  if (!hasDatabase) return null;
  const {data} = await db()
    .from("users")
    .select("wallet")
    .ilike("handle", handleIlike(handle))
    .maybeSingle();
  return (data as {wallet?: string} | null)?.wallet ?? null;
}

/** Insert a users stub so follow FKs can land before they edit their profile. */
export async function ensureUser(id: string): Promise<void> {
  if (!hasDatabase || !id) return;
  const existing = await userById(id);
  if (existing) return;
  await db().from("users").insert({id});
}

/** The caller's own users row. One indexed read. */
export async function userById(id: string): Promise<{
  displayName: string | null;
  handle: string | null;
  pfpUrl: string | null;
  wallet: string | null;
  bio: string;
} | null> {
  if (!hasDatabase) return null;
  const {data} = await db()
    .from("users")
    .select("handle, display_name, pfp_url, wallet, bio")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    displayName: data.display_name,
    handle: data.handle,
    pfpUrl: data.pfp_url,
    wallet: data.wallet,
    bio: data.bio ?? "",
  };
}

/** Creates or refreshes the caller's row. Identity comes from the token. */
export async function upsertUser(input: {
  id: string;
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  wallet: string | null;
}): Promise<void> {
  if (!hasDatabase) return;
  await db()
    .from("users")
    .upsert(
      {
        id: input.id,
        handle: input.handle,
        display_name: input.displayName,
        pfp_url: input.pfpUrl,
        wallet: input.wallet,
      },
      {onConflict: "id"},
    );
}

export async function saveProfile(
  id: string,
  patch: {displayName?: string | null; bio?: string | null; socials?: unknown},
): Promise<void> {
  if (!hasDatabase) return;
  await db()
    .from("users")
    .update({
      display_name: patch.displayName ?? null,
      bio: patch.bio ?? null,
      socials: patch.socials ?? {},
    })
    .eq("id", id);
}

export async function commentsFor(assetId: string): Promise<AssetComment[]> {
  if (!hasDatabase) return [];

  const {data, error} = await db()
    .from("comments")
    .select("id, asset_id, parent_id, body, created_at, users(handle, display_name, pfp_url)")
    .eq("asset_id", assetId)
    .order("created_at", {ascending: true})
    .limit(200);

  if (error || !data) return [];

  return data.map((row) => {
    const user = one((row as {users?: CommentAuthor | CommentAuthor[]}).users);
    return {
      id: String(row.id),
      assetId: String(row.asset_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      author: {
        handle: user?.handle ?? "trader",
        displayName: user?.display_name ?? user?.handle ?? "Trader",
        pfpUrl: user?.pfp_url ?? null,
      },
      body: String(row.body),
      createdAt: String(row.created_at),
    };
  });
}

export async function addComment(input: {
  userId: string;
  assetId: string;
  parentId: string | null;
  body: string;
}): Promise<AssetComment | null> {
  if (!hasDatabase) return null;

  const {data, error} = await db()
    .from("comments")
    .insert({
      user_id: input.userId,
      asset_id: input.assetId,
      parent_id: input.parentId,
      body: input.body.slice(0, 500),
    })
    .select("id, asset_id, parent_id, body, created_at, users(handle, display_name, pfp_url)")
    .single();

  if (error || !data) return null;

  const user = one((data as {users?: CommentAuthor | CommentAuthor[]}).users);
  return {
    id: String(data.id),
    assetId: String(data.asset_id),
    parentId: data.parent_id ? String(data.parent_id) : null,
    author: {
      handle: user?.handle ?? "you",
      displayName: user?.display_name ?? "You",
      pfpUrl: user?.pfp_url ?? null,
    },
    body: String(data.body),
    createdAt: String(data.created_at),
  };
}

export async function setFollow(
  followerId: string,
  followingHandle: string,
  following: boolean,
): Promise<boolean> {
  if (!hasDatabase) return false;

  const needle = handleIlike(followingHandle);
  if (!needle) return false;

  const {data: target} = await db()
    .from("users")
    .select("id")
    .ilike("handle", needle)
    .maybeSingle();

  if (!target?.id) return false;

  await ensureUser(followerId);

  if (following) {
    const {error} = await db()
      .from("follows")
      .upsert({follower_id: followerId, following_id: target.id});
    if (error) return false;
  } else {
    const {error} = await db()
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", target.id);
    if (error) return false;
  }
  return true;
}

/** Handles the caller follows. */
export async function followingOf(userId: string): Promise<string[]> {
  if (!hasDatabase) return [];
  const {data} = await db()
    .from("follows")
    .select("users!follows_following_id_fkey(id, handle)")
    .eq("follower_id", userId);

  return (data ?? [])
    .map((row) => {
      const user = one(
        (row as {users?: {id?: string; handle?: string} | {id?: string; handle?: string}[]})
          .users,
      );
      return fallbackHandle(user);
    })
    .filter((handle): handle is string => Boolean(handle));
}

/**
 * Characters PostgREST reads as structure inside an `or` filter.
 *
 * The query went into that string raw. A comma started a new condition, a
 * closing bracket ended the group, a dot separated column from operator and
 * an asterisk is the wildcard — so searching for a name with a comma in it
 * did not fail loudly, it silently became a different filter. Escaping the
 * wildcards and refusing the structural characters keeps a search a search.
 */
function forOrFilter(value: string): string {
  return value
    // LIKE wildcards, so a literal % or _ matches itself rather than any run
    // of characters.
    .replace(/[%_]/g, (ch) => "\\" + ch)
    // PostgREST structure. Dropped rather than escaped: none of them are
    // worth matching a person on, and each one could end the condition
    // early and turn the search into a different query.
    .replace(/[(),.:*"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchUsers(
  query: string,
  limit = SEARCH_USER_LIMIT,
): Promise<Profile[]> {
  if (!hasDatabase) return [];
  const raw = query.trim().replace(/^@/, "");
  const q = forOrFilter(raw);
  if (!q) return [];

  const {data} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url, bio, socials, wallet")
    .or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(limit);

  return (data ?? []).map((row) => toProfile(row as UserRow));
}

export async function profileByHandle(handle: string): Promise<Profile | null> {
  if (!hasDatabase) return null;
  const {data} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url, bio, socials, wallet")
    .ilike("handle", handleIlike(handle))
    .maybeSingle();

  if (!data) return null;

  const [{count: followers}, {count: following}] = await Promise.all([
    db().from("follows").select("*", {count: "exact", head: true}).eq("following_id", data.id),
    db().from("follows").select("*", {count: "exact", head: true}).eq("follower_id", data.id),
  ]);

  return toProfile(data as UserRow, followers ?? 0, following ?? 0);
}

/** Handles following a given account, by that account's handle. */
export async function followersOf(handle: string): Promise<string[]> {
  return edgesFor(handle, "followers");
}

/** Handles a given account follows, by that account's handle. */
export async function followingByHandle(handle: string): Promise<string[]> {
  return edgesFor(handle, "following");
}

/**
 * One side of the follow graph for an account named by handle.
 *
 * Both directions are the same query against opposite columns, so they share
 * an implementation rather than drifting apart. `followingOf` above stays
 * separate because it is keyed on the caller's id from their token, which is
 * the one case where no handle lookup is needed or wanted.
 */
async function edgesFor(
  handle: string,
  side: "followers" | "following",
): Promise<string[]> {
  if (!hasDatabase) return [];

  const {data: user} = await db()
    .from("users")
    .select("id")
    .ilike("handle", handleIlike(handle))
    .maybeSingle();

  if (!user?.id) return [];

  const [match, join] =
    side === "followers"
      ? (["following_id", "users!follows_follower_id_fkey(id, handle)"] as const)
      : (["follower_id", "users!follows_following_id_fkey(id, handle)"] as const);

  const {data} = await db().from("follows").select(join).eq(match, user.id);

  return (data ?? [])
    .map((row) => {
      const joined = one(
        (row as {users?: {id?: string; handle?: string} | {id?: string; handle?: string}[]})
          .users,
      );
      return fallbackHandle(joined);
    })
    .filter((entry): entry is string => Boolean(entry));
}

/**
 * Profiles for a set of handles, in the order asked for.
 *
 * One query rather than one per handle: follower lists render dozens of these
 * at once, and the counts are left at zero because a list row shows a name and
 * a picture, not a follower tally.
 */
export async function profilesByHandles(
  handles: string[],
): Promise<Profile[]> {
  if (!hasDatabase || handles.length === 0) return [];

  const wanted = handles.map((handle) => normalizeHandle(handle));

  const {data} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url, bio, socials, wallet")
    .in("handle", wanted);

  const byHandle = new Map(
    (data ?? []).map((row) => {
      const user = row as UserRow;
      return [user.handle?.toLowerCase() ?? user.id.slice(-8).toLowerCase(), toProfile(user)];
    }),
  );

  return wanted
    .map((handle) => byHandle.get(handle.toLowerCase()))
    .filter((profile): profile is Profile => profile !== undefined);
}

/**
 * Handles following the caller.
 *
 * Keyed on the id from their token rather than a handle, so it needs no lookup
 * and works before the account has picked one.
 */
export async function followersOfId(userId: string): Promise<string[]> {
  return (await followerProfilesOfId(userId)).map((profile) => profile.handle);
}

/** Full follower profiles, including people who have not picked a handle. */
export async function followerProfilesOfId(userId: string): Promise<Profile[]> {
  if (!hasDatabase) return [];

  const {data} = await db()
    .from("follows")
    .select(
      "users!follows_follower_id_fkey(id, handle, display_name, pfp_url, bio, socials, wallet)",
    )
    .eq("following_id", userId);

  return (data ?? [])
    .map((row) => {
      const joined = one(
        (row as {users?: UserRow | UserRow[]}).users,
      );
      return joined ? toProfile(joined) : null;
    })
    .filter((profile): profile is Profile => profile !== null);
}
