import {
  alertPrefsFromRow,
  alertPrefsToRow,
  mergeActivity,
  type Activity,
  type ActivityAsset,
  type ActivityPerson,
  type AlertPrefs,
  type BellItem,
  type FollowingItem,
} from "@/lib/alerts";
import {isAddress, normalizeAddress} from "@/lib/address";
import {db, hasDatabase} from "@/lib/server/db";
import {RWA_BY_ADDRESS, RWA_BY_TICKER} from "@/lib/server/live/robinhood";
import {getTokenRows} from "@/lib/server/live/universeStore";

/**
 * What the desktop terminal's Following tab and bell read, in one request.
 *
 * Nothing here is fanned out at write time. The feed is the trades and
 * comments of the people you follow, read when asked; the bell is replies to
 * your comments and your newest followers, read the same way. The only state
 * of its own is the pair of "seen up to" marks in `alert_prefs`.
 */

const FEED_LIMIT = 50;

/**
 * Before `scripts/schema-following.sql` has been run, the new tables are
 * missing. Reads treat that as "nothing yet" rather than failing the whole
 * feed; saving settings still fails, and says so.
 */
function missingTable(error: {code?: string} | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
const BELL_LIMIT = 30;

type UserRow = {id: string; handle: string | null; display_name: string | null; pfp_url: string | null};

function person(row: UserRow | undefined, id: string): ActivityPerson {
  return {
    id,
    handle: row?.handle ?? "trader",
    displayName: row?.display_name ?? row?.handle ?? "Trader",
    pfpUrl: row?.pfp_url ?? null,
  };
}

async function usersById(ids: string[]): Promise<Map<string, UserRow>> {
  if (ids.length === 0) return new Map();
  const {data, error} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url")
    .in("id", [...new Set(ids)]);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [String(row.id), row as UserRow]));
}

/** Symbols, logos and pairings for the assets the rows point at. */
async function assetsById(ids: string[]): Promise<(id: string) => ActivityAsset> {
  const tokenIds = [...new Set(ids.filter((id) => isAddress(id)).map(normalizeAddress))];
  const tokens = new Map(
    (tokenIds.length > 0 ? await getTokenRows(tokenIds) : []).map((row) => [
      normalizeAddress(row.address),
      row,
    ]),
  );
  return (id) => {
    if (isAddress(id)) {
      const address = normalizeAddress(id);
      const row = tokens.get(address);
      const paired =
        row?.quote_kind === "rwa"
          ? (RWA_BY_ADDRESS.get(row.quote_token ?? "")?.ticker ?? row.reward_rwa ?? null)
          : row?.quote_kind === "usdg"
            ? "USDG"
            : row?.quote_kind === "eth"
              ? "WETH"
              : null;
      return {
        kind: "token",
        id: address,
        symbol: row?.symbol ?? "TOKEN",
        pairedTicker: paired,
        imageUrl: row?.image_64 ?? row?.image_url ?? null,
      };
    }
    const ticker = id.toUpperCase();
    return {
      kind: "rwa",
      id: ticker,
      symbol: ticker,
      pairedTicker: null,
      imageUrl: RWA_BY_TICKER.get(ticker)?.logoUrl ?? null,
    };
  };
}

export async function alertPrefsFor(userId: string): Promise<{
  prefs: AlertPrefs;
  followingSeenAt: string | null;
  bellSeenAt: string | null;
}> {
  if (!hasDatabase) return {prefs: alertPrefsFromRow(null), followingSeenAt: null, bellSeenAt: null};
  const {data, error} = await db()
    .from("alert_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && !missingTable(error)) throw error;
  const row = (error ? null : data) as Record<string, unknown> | null;
  return {
    prefs: alertPrefsFromRow(row),
    followingSeenAt: typeof row?.following_seen_at === "string" ? row.following_seen_at : null,
    bellSeenAt: typeof row?.bell_seen_at === "string" ? row.bell_seen_at : null,
  };
}

export async function saveAlertPrefs(userId: string, patch: Partial<AlertPrefs>): Promise<AlertPrefs> {
  const {prefs} = await alertPrefsFor(userId);
  const next = {...prefs, ...patch};
  if (!hasDatabase) return next;
  const {error} = await db()
    .from("alert_prefs")
    .upsert({user_id: userId, ...alertPrefsToRow(next), updated_at: new Date().toISOString()});
  if (error) throw error;
  return next;
}

/** Moves a "seen up to" mark forward; never back, so two tabs cannot undo each other. */
export async function markSeen(userId: string, which: "following" | "bell", at: string): Promise<void> {
  if (!hasDatabase) return;
  const column = which === "following" ? "following_seen_at" : "bell_seen_at";
  const stamp = new Date(Math.min(Date.parse(at), Date.now())).toISOString();
  const current = await alertPrefsFor(userId);
  const previous = which === "following" ? current.followingSeenAt : current.bellSeenAt;
  if (previous && Date.parse(previous) >= Date.parse(stamp)) return;
  const {error} = await db()
    .from("alert_prefs")
    .upsert({user_id: userId, [column]: stamp, updated_at: new Date().toISOString()});
  if (error) throw error;
}

async function followingFeed(userId: string, ids: string[]): Promise<FollowingItem[]> {
  if (ids.length === 0) return [];
  const [trades, comments] = await Promise.all([
    db()
      .from("hodl_trades")
      .select("tx_hash, user_id, side, kind, asset_id, usd, traded_at")
      .in("user_id", ids)
      .order("traded_at", {ascending: false})
      .limit(FEED_LIMIT),
    db()
      .from("comments")
      .select("id, user_id, asset_id, body, created_at")
      .in("user_id", ids)
      .order("created_at", {ascending: false})
      .limit(FEED_LIMIT),
  ]);
  if (trades.error && !missingTable(trades.error)) throw trades.error;
  if (comments.error) throw comments.error;
  const tradeRows = trades.error ? [] : (trades.data ?? []);
  const commentRows = comments.data ?? [];

  const [people, asset] = await Promise.all([
    usersById([...tradeRows, ...commentRows].map((row) => String(row.user_id))),
    assetsById([...tradeRows, ...commentRows].map((row) => String(row.asset_id))),
  ]);

  return mergeActivity<FollowingItem>(
    [
      tradeRows.map((row) => ({
        type: "trade" as const,
        id: String(row.tx_hash),
        at: new Date(String(row.traded_at)).toISOString(),
        person: person(people.get(String(row.user_id)), String(row.user_id)),
        side: row.side === "sell" ? ("sell" as const) : ("buy" as const),
        usd: row.usd == null ? null : Number(row.usd),
        asset: asset(String(row.asset_id)),
      })),
      commentRows.map((row) => ({
        type: "comment" as const,
        id: String(row.id),
        at: new Date(String(row.created_at)).toISOString(),
        person: person(people.get(String(row.user_id)), String(row.user_id)),
        body: String(row.body),
        asset: asset(String(row.asset_id)),
      })),
    ],
    FEED_LIMIT,
  );
}

async function bellFeed(userId: string): Promise<BellItem[]> {
  const [replies, followers] = await Promise.all([
    // Replies whose parent is one of your comments, from anyone but you.
    db()
      .from("comments")
      .select("id, user_id, asset_id, body, created_at, parent:parent_id!inner(user_id)")
      .eq("parent.user_id", userId)
      .neq("user_id", userId)
      .order("created_at", {ascending: false})
      .limit(BELL_LIMIT),
    db()
      .from("follows")
      .select("follower_id, created_at")
      .eq("following_id", userId)
      .neq("follower_id", userId)
      .order("created_at", {ascending: false})
      .limit(BELL_LIMIT),
  ]);
  if (replies.error) throw replies.error;
  if (followers.error) throw followers.error;
  const replyRows = replies.data ?? [];
  const followerRows = followers.data ?? [];

  const [people, asset] = await Promise.all([
    usersById([
      ...replyRows.map((row) => String(row.user_id)),
      ...followerRows.map((row) => String(row.follower_id)),
    ]),
    assetsById(replyRows.map((row) => String(row.asset_id))),
  ]);

  return mergeActivity<BellItem>(
    [
      replyRows.map((row) => ({
        type: "reply" as const,
        id: String(row.id),
        at: new Date(String(row.created_at)).toISOString(),
        person: person(people.get(String(row.user_id)), String(row.user_id)),
        body: String(row.body),
        asset: asset(String(row.asset_id)),
      })),
      followerRows.map((row) => ({
        type: "follow" as const,
        id: `follow:${row.follower_id}`,
        at: new Date(String(row.created_at)).toISOString(),
        person: person(people.get(String(row.follower_id)), String(row.follower_id)),
      })),
    ],
    BELL_LIMIT,
  );
}

export async function activityFor(userId: string): Promise<Activity & {prefs: AlertPrefs}> {
  if (!hasDatabase) {
    return {following: [], bell: [], followingSeenAt: null, bellSeenAt: null, followingCount: 0, prefs: alertPrefsFromRow(null)};
  }
  const {data: edges, error} = await db()
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  if (error) throw error;
  // Never your own trades or comments, even if a follow of yourself slipped in.
  const ids = [...new Set((edges ?? []).map((row) => String(row.following_id)))].filter(
    (id) => id !== userId,
  );

  const [following, bell, seen] = await Promise.all([
    followingFeed(userId, ids),
    bellFeed(userId),
    alertPrefsFor(userId),
  ]);
  return {
    following,
    bell,
    followingSeenAt: seen.followingSeenAt,
    bellSeenAt: seen.bellSeenAt,
    followingCount: ids.length,
    prefs: seen.prefs,
  };
}
