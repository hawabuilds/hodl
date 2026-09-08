import {followDedupeKey} from "@/lib/notifications/dedupe";
import {
  followCopy,
  handlesFromFollowRows,
  replyBatchCopy,
  replyCopy,
} from "@/lib/notifications/copy";
import {assetPath, profilePath} from "@/lib/routes";
import {db, hasDatabase} from "@/lib/server/db";
import {userById} from "@/lib/server/social-live";
import {getTokenRow} from "@/lib/server/live/universeStore";
import {enqueueNotification} from "./dispatch";

const BATCH_MS = 20 * 60_000;

export async function notifyFollowed(targetUserId: string, followerUserId: string): Promise<void> {
  if (targetUserId === followerUserId) return;
  const follower = await userById(followerUserId);
  const handle = follower?.handle ?? "someone";
  let handles = [handle];
  if (hasDatabase) {
    const windowStart = new Date(Date.now() - BATCH_MS).toISOString();
    const {data: recent} = await db()
      .from("notification_log")
      .select("body, payload")
      .eq("user_id", targetUserId)
      .eq("kind", "follow")
      .gte("created_at", windowStart)
      .order("created_at", {ascending: true})
      .limit(40);
    handles = handlesFromFollowRows(recent ?? []);
    if (!handles.some((row) => row.toLowerCase() === handle.toLowerCase())) {
      handles.push(handle);
    }
  }
  const copy = followCopy(handles);
  const result = await enqueueNotification({
    userId: targetUserId,
    channel: "social",
    kind: "follow",
    title: copy.title,
    body: copy.body,
    url: profilePath(handle),
    dedupeKey: followDedupeKey(targetUserId, followerUserId),
    digest: {type: "follow", n: 1},
    handles: [handle],
  });
  console.info("follow notify", result);
}

/** So unfollow + follow is a new event, not skipped by the old pair key. */
export async function clearFollowNotification(targetUserId: string, followerUserId: string): Promise<void> {
  if (!hasDatabase) return;
  await db()
    .from("notification_log")
    .delete()
    .eq("user_id", targetUserId)
    .eq("kind", "follow")
    .eq("dedupe_key", followDedupeKey(targetUserId, followerUserId));
}

export async function notifyCommentReply(input: {
  commentId: string;
  parentId: string;
  assetId: string;
  authorId: string;
  body?: string;
  ticker?: string;
}): Promise<void> {
  if (!hasDatabase) return;
  const {data: parent} = await db()
    .from("comments")
    .select("id, user_id, asset_id")
    .eq("id", input.parentId)
    .maybeSingle();
  if (!parent?.user_id || parent.user_id === input.authorId) return;
  const kind = input.assetId.startsWith("0x") ? "token" : "rwa";
  const author = await userById(input.authorId);
  const handle = author?.handle ?? "someone";
  const url = `${assetPath(kind, input.assetId)}#comment-${input.commentId}`;

  let replyText = input.body?.trim() ?? "";
  if (!replyText) {
    const {data: comment} = await db()
      .from("comments")
      .select("body")
      .eq("id", input.commentId)
      .maybeSingle();
    replyText = String(comment?.body ?? "").trim();
  }

  let ticker = input.ticker?.trim() ?? "";
  if (!ticker) {
    if (kind === "token") {
      const row = await getTokenRow(input.assetId).catch(() => null);
      ticker = row?.symbol ?? "TOKEN";
    } else {
      ticker = input.assetId;
    }
  }

  const windowStart = new Date(Date.now() - BATCH_MS).toISOString();
  const {data: recent} = await db()
    .from("notification_log")
    .select("payload")
    .eq("user_id", parent.user_id)
    .eq("kind", "reply")
    .gte("created_at", windowStart)
    .limit(40);
  const sameThread = (recent ?? []).filter((row) => {
    const payload = row.payload as {d?: {parentId?: string}} | null;
    return payload?.d?.parentId === input.parentId;
  });
  const n = sameThread.length + 1;
  const copy = n > 1 ? replyBatchCopy(n, ticker) : replyCopy(handle, replyText);
  await enqueueNotification({
    userId: parent.user_id,
    channel: "social",
    kind: "reply",
    title: copy.title,
    body: copy.body,
    url,
    dedupeKey: `reply:${input.commentId}`,
    digest: {type: "reply", ticker, n: 1, parentId: input.parentId},
  });
}
