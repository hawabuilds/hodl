import type {
  AssetComment,
  CommentPositionView,
  FollowingComment,
  Profile,
} from "@/lib/types";
import {fallbackHandle, handleIlike, normalizeHandle} from "@/lib/handle";
import {isAddress, normalizeAddress} from "@/lib/address";
import {db, hasDatabase} from "./db";
import {commentPosition, positionCanComment} from "@/lib/commentPosition";

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
  portfolio_public?: boolean | null;
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
  // Public by default; Settings is where it gets turned off. Stated here as
  // well as in the column default so a stub is public even against a database
  // whose default was never migrated.
  await db().from("users").insert({id, portfolio_public: true});
}

/** The caller's own users row. One indexed read. */
export async function userById(id: string): Promise<{
  displayName: string | null;
  handle: string | null;
  pfpUrl: string | null;
  wallet: string | null;
  bio: string;
  portfolioPublic: boolean;
} | null> {
  if (!hasDatabase) return null;
  const {data} = await db()
    .from("users")
    .select("handle, display_name, pfp_url, wallet, bio, portfolio_public")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    displayName: data.display_name,
    handle: data.handle,
    pfpUrl: data.pfp_url,
    wallet: data.wallet,
    bio: data.bio ?? "",
    portfolioPublic: data.portfolio_public !== false,
  };
}

/** Whether a handle shows holdings publicly (false = opted out; null/true = show). */
export async function portfolioPublicForHandle(handle: string): Promise<boolean> {
  if (!hasDatabase) return true;
  const {data} = await db()
    .from("users")
    .select("portfolio_public")
    .ilike("handle", handleIlike(handle))
    .maybeSingle();
  return (data as {portfolio_public?: boolean} | null)?.portfolio_public !== false;
}

export async function savePortfolioPublic(
  id: string,
  portfolioPublic: boolean,
): Promise<void> {
  if (!hasDatabase) return;
  await db()
    .from("users")
    .update({portfolio_public: portfolioPublic})
    .eq("id", id);
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

/**
 * Comments for an asset, each with its like count and its author's position.
 *
 * Three reads rather than one, because PostgREST cannot aggregate a child
 * table and join a second one keyed on a different column in the same query.
 * They are issued together and all three are scoped to the comments actually
 * being returned, so the cost does not grow with the size of either table.
 *
 * `viewerId` only decides whether each comment comes back as liked by *you*.
 * It never filters what is returned.
 */
export async function commentsFor(
  assetId: string,
  viewerId?: string | null,
): Promise<AssetComment[]> {
  if (!hasDatabase) return [];

  const {data, error} = await db()
    .from("comments")
    .select(
      "id, asset_id, parent_id, body, created_at, user_id, users!comments_user_id_fkey(handle, display_name, pfp_url)",
    )
    .eq("asset_id", assetId)
    .order("created_at", {ascending: true})
    .limit(200);

  if (error || !data) return [];

  const ids = data.map((row) => String(row.id));
  const authorIds = [...new Set(data.map((row) => String(row.user_id)))];

  const [likes, positions] = await Promise.all([
    likeCounts(ids, viewerId ?? null),
    positionsForAuthors(authorIds, assetId),
  ]);

  return data.map((row) => {
    const user = one((row as {users?: CommentAuthor | CommentAuthor[]}).users);
    const id = String(row.id);
    const tally = likes.get(id);
    return {
      id,
      assetId: String(row.asset_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      author: {
        handle: user?.handle ?? "trader",
        displayName: user?.display_name ?? user?.handle ?? "Trader",
        pfpUrl: user?.pfp_url ?? null,
      },
      body: String(row.body),
      createdAt: String(row.created_at),
      likes: tally?.count ?? 0,
      liked: tally?.liked ?? false,
      position: positions.get(String(row.user_id)) ?? null,
    };
  });
}

/** Like tallies for a set of comments, and whether the viewer is among them. */
async function likeCounts(
  commentIds: string[],
  viewerId: string | null,
): Promise<Map<string, {count: number; liked: boolean}>> {
  const out = new Map<string, {count: number; liked: boolean}>();
  if (!hasDatabase || commentIds.length === 0) return out;

  const {data, error} = await db()
    .from("comment_likes")
    .select("comment_id, user_id")
    .in("comment_id", commentIds);

  // A missing table or a failed read means no likes shown, never a crash that
  // costs the page its comments.
  if (error || !data) return out;

  for (const row of data) {
    const id = String((row as {comment_id: string}).comment_id);
    const entry = out.get(id) ?? {count: 0, liked: false};
    entry.count += 1;
    if (viewerId && String((row as {user_id: string}).user_id) === viewerId) {
      entry.liked = true;
    }
    out.set(id, entry);
  }
  return out;
}

/** Each author's position in this one asset. */
async function positionsForAuthors(
  userIds: string[],
  assetId: string,
): Promise<Map<string, CommentPositionView>> {
  const out = new Map<string, CommentPositionView>();
  if (!hasDatabase || userIds.length === 0) return out;

  const {data, error} = await db()
    .from("user_positions")
    .select("user_id, amount, value_usd, cost_usd")
    .eq("asset_id", assetId)
    .in("user_id", userIds);

  if (error || !data) return out;

  for (const row of data) {
    const entry = row as {
      user_id: string;
      amount: number;
      value_usd: number;
      cost_usd: number | null;
    };
    const view = commentPosition({
      amount: Number(entry.amount),
      valueUsd: Number(entry.value_usd),
      costUsd: entry.cost_usd === null ? null : Number(entry.cost_usd),
    });
    if (view) out.set(String(entry.user_id), view);
  }
  return out;
}

/**
 * Whether this person may comment on this asset.
 *
 * Speaking about an asset requires holding it. A read that fails is not a
 * refusal — it returns false, so the composer says "hold X to comment"
 * rather than letting a post through that the POST route would then reject.
 */
export async function holdsAsset(userId: string, assetId: string): Promise<boolean> {
  if (!hasDatabase) return false;

  const {data} = await db()
    .from("user_positions")
    .select("amount, value_usd, cost_usd")
    .eq("user_id", userId)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (data) {
    const row = data as {amount: number; value_usd: number; cost_usd: number | null};
    if (
      positionCanComment({
        amount: Number(row.amount),
        valueUsd: Number(row.value_usd),
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      })
    ) {
      return true;
    }
  }

  /*
   * No row, or a row that says they are out. Ask the chain before refusing.
   *
   * `user_positions` is written when someone opens their portfolio, so it is a
   * cache of who has visited that page — not a record of who holds what. A
   * holder who has never opened it has no row at all, and telling them to
   * "hold X to comment" while they hold X is the worst version of this
   * feature. The balance is one `balanceOf`, and it is the actual question.
   *
   * A read that throws returns false: that is a refusal to confirm, and the
   * POST route treats it as "not holding" rather than letting a post through
   * on an RPC hiccup. It costs a real holder a retry, not their position.
   */
  return balanceHolds(userId, assetId);
}

async function balanceHolds(userId: string, assetId: string): Promise<boolean> {
  if (!isAddress(assetId)) return false;

  const {data} = await db()
    .from("users")
    .select("wallet")
    .eq("id", userId)
    .maybeSingle();

  const wallet = (data as {wallet?: string} | null)?.wallet;
  if (!wallet || !isAddress(wallet)) return false;

  try {
    const {rpc, erc20Abi} = await import("./live/chain");
    const balance = await rpc().readContract({
      address: normalizeAddress(assetId) as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [normalizeAddress(wallet) as `0x${string}`],
    });
    return typeof balance === "bigint" && balance > 0n;
  } catch {
    return false;
  }
}

/**
 * Like or unlike, returning the new tally.
 *
 * The primary key does the deduplicating, so a double-tap cannot inflate a
 * count, and the tally is re-counted from the table rather than adjusted
 * locally — two devices liking at once should not be able to disagree.
 */
export async function setCommentLike(input: {
  commentId: string;
  userId: string;
  liked: boolean;
}): Promise<{likes: number; liked: boolean} | null> {
  if (!hasDatabase) return null;

  if (input.liked) {
    const {error} = await db()
      .from("comment_likes")
      .upsert(
        {comment_id: input.commentId, user_id: input.userId},
        {onConflict: "comment_id,user_id"},
      );
    if (error) return null;
  } else {
    const {error} = await db()
      .from("comment_likes")
      .delete()
      .eq("comment_id", input.commentId)
      .eq("user_id", input.userId);
    if (error) return null;
  }

  const {count} = await db()
    .from("comment_likes")
    .select("*", {count: "exact", head: true})
    .eq("comment_id", input.commentId);

  return {likes: count ?? 0, liked: input.liked};
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
    .select("id, asset_id, parent_id, body, created_at, users!comments_user_id_fkey(handle, display_name, pfp_url)")
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
    likes: 0,
    liked: false,
    // Filled by the next fetch. Guessing it here would mean reading the
    // position a second time to tell someone what they already know.
    position: null,
  };
}

export async function setFollow(
  followerId: string,
  followingHandle: string,
  following: boolean,
): Promise<{ok: boolean; targetId?: string}> {
  if (!hasDatabase) return {ok: false};

  const needle = handleIlike(followingHandle);
  if (!needle) return {ok: false};

  const {data: target} = await db()
    .from("users")
    .select("id")
    .ilike("handle", needle)
    .maybeSingle();

  if (!target?.id) return {ok: false};

  await ensureUser(followerId);

  if (following) {
    const {error} = await db()
      .from("follows")
      .upsert({follower_id: followerId, following_id: target.id});
    if (error) return {ok: false};
  } else {
    const {error} = await db()
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("following_id", target.id);
    if (error) return {ok: false};
  }
  return {ok: true, targetId: target.id};
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

  const rows = (data ?? []) as UserRow[];
  // Search results carry a follower count on the card, so they have to be
  // counted like every other list of profiles. Leaving them to `toProfile`'s
  // default published "0 followers" next to every person in the tab —
  // a wrong number reads as a real one, where a missing number would not.
  const counts = await followerCountsFor(rows.map((row) => row.id));

  return rows.map((row) => toProfile(row, counts.get(row.id) ?? 0));
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

/** Follower counts for a batch of user ids — one query for whole lists. */
async function followerCountsFor(userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!hasDatabase || userIds.length === 0) return counts;
  for (const id of userIds) counts.set(id, 0);

  const {data} = await db()
    .from("follows")
    .select("following_id")
    .in("following_id", userIds);

  for (const row of data ?? []) {
    const id = String((row as {following_id: string}).following_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Profiles for a set of handles, in the order asked for.
 *
 * One query rather than one per handle: follower lists render dozens of these
 * at once, with follower counts batched in a second read.
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

  const rows = (data ?? []) as UserRow[];
  const counts = await followerCountsFor(rows.map((row) => row.id));

  const byHandle = new Map(
    rows.map((row) => {
      return [
        row.handle?.toLowerCase() ?? row.id.slice(-8).toLowerCase(),
        toProfile(row, counts.get(row.id) ?? 0),
      ];
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

  const rows = (data ?? [])
    .map((row) => one((row as {users?: UserRow | UserRow[]}).users))
    .filter((row): row is UserRow => row !== undefined);

  const counts = await followerCountsFor(rows.map((row) => row.id));

  return rows.map((row) => toProfile(row, counts.get(row.id) ?? 0));
}

/**
 * The newest comments by the people `userId` follows, across every asset.
 *
 * For Home. Read failures throw rather than coming back empty, so the card can
 * say it could not load instead of implying nobody said anything.
 */
export async function commentsFromFollowing(
  userId: string,
  limit = 3,
): Promise<FollowingComment[]> {
  if (!hasDatabase) return [];

  const {data: edges, error: edgesError} = await db()
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  if (edgesError) throw edgesError;

  const ids = (edges ?? []).map((row) => String(row.following_id));
  if (ids.length === 0) return [];

  const {data, error} = await db()
    .from("comments")
    .select(
      "id, asset_id, body, created_at, users!comments_user_id_fkey(handle, display_name, pfp_url)",
    )
    .in("user_id", ids)
    .order("created_at", {ascending: false})
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];

  // Tokens are keyed by address, RWAs by ticker; a token needs its symbol.
  const tokenIds = [
    ...new Set(rows.map((row) => String(row.asset_id)).filter((id) => isAddress(id))),
  ];
  const symbols = new Map<string, string>();
  if (tokenIds.length > 0) {
    const {getTokenRows} = await import("./live/universeStore");
    for (const token of await getTokenRows(tokenIds)) {
      if (token.symbol) symbols.set(normalizeAddress(token.address), token.symbol);
    }
  }

  return rows.map((row) => {
    const user = one((row as {users?: CommentAuthor | CommentAuthor[]}).users);
    const assetId = String(row.asset_id);
    const token = isAddress(assetId);
    return {
      id: String(row.id),
      body: String(row.body),
      createdAt: String(row.created_at),
      author: {
        handle: user?.handle ?? "trader",
        displayName: user?.display_name ?? user?.handle ?? "Trader",
        pfpUrl: user?.pfp_url ?? null,
      },
      asset: {
        kind: token ? "token" : "rwa",
        id: token ? normalizeAddress(assetId) : assetId,
        label: token
          ? (symbols.get(normalizeAddress(assetId)) ?? "a token")
          : assetId.toUpperCase(),
      },
    };
  });
}
