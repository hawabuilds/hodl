import type {AssetComment, Profile} from "@/lib/types";
import {db, hasDatabase} from "./db";

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
    wallet: row.wallet ?? "0x",
    followers,
    following,
    holdings: [],
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

  const {data: target} = await db()
    .from("users")
    .select("id")
    .eq("handle", followingHandle.replace(/^@/, ""))
    .maybeSingle();

  if (!target?.id) return false;

  if (following) {
    await db()
      .from("follows")
      .upsert({follower_id: followerId, following_id: target.id});
  } else {
    await db()
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", target.id);
  }
  return true;
}

/** Handles the caller follows. */
export async function followingOf(userId: string): Promise<string[]> {
  if (!hasDatabase) return [];
  const {data} = await db()
    .from("follows")
    .select("users!follows_following_id_fkey(handle)")
    .eq("follower_id", userId);

  return (data ?? [])
    .map((row) => {
      const user = one((row as {users?: {handle?: string} | {handle?: string}[]}).users);
      return user?.handle ?? null;
    })
    .filter((handle): handle is string => Boolean(handle));
}

export async function searchUsers(query: string): Promise<Profile[]> {
  if (!hasDatabase) return [];
  const q = query.trim().replace(/^@/, "");
  if (!q) return [];

  const {data} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url, bio, socials, wallet")
    .or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(20);

  return (data ?? []).map((row) => toProfile(row as UserRow));
}

export async function profileByHandle(handle: string): Promise<Profile | null> {
  if (!hasDatabase) return null;
  const {data} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url, bio, socials, wallet")
    .eq("handle", handle.replace(/^@/, ""))
    .maybeSingle();

  if (!data) return null;

  const [{count: followers}, {count: following}] = await Promise.all([
    db().from("follows").select("*", {count: "exact", head: true}).eq("following_id", data.id),
    db().from("follows").select("*", {count: "exact", head: true}).eq("follower_id", data.id),
  ]);

  return toProfile(data as UserRow, followers ?? 0, following ?? 0);
}
