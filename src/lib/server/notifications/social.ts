import {assetPath, profilePath} from "@/lib/routes";
import {db, hasDatabase} from "@/lib/server/db";
import {enqueueNotification} from "./dispatch";
import {userById} from "@/lib/server/social-live";

export async function notifyFollowed(targetUserId: string, followerUserId: string): Promise<void> {
  if (targetUserId === followerUserId) return;
  const follower = await userById(followerUserId);
  const handle = follower?.handle ?? "someone";
  await enqueueNotification({
    userId: targetUserId,
    channel: "social",
    kind: "follow",
    title: `@${handle} followed you`,
    body: `@${handle} followed you`,
    url: profilePath(handle),
    dedupeKey: `follow:${targetUserId}:${followerUserId}`,
  });
}

export async function notifyCommentReply(input: {
  commentId: string;
  parentId: string;
  assetId: string;
  authorId: string;
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

  const windowStart = new Date(Date.now() - 20 * 60_000).toISOString();
  const {count} = await db()
    .from("notification_log")
    .select("*", {count: "exact", head: true})
    .eq("user_id", parent.user_id)
    .eq("kind", "reply")
    .eq("url", url.split("#")[0] ?? url)
    .gte("created_at", windowStart);
  const n = (count ?? 0) + 1;
  await enqueueNotification({
    userId: parent.user_id,
    channel: "social",
    kind: "reply",
    title: n > 1 ? `${n} people replied to your comment` : `@${handle} replied to your comment`,
    body: n > 1 ? `${n} people replied to your comment` : `@${handle} replied`,
    url,
    dedupeKey: n > 1 ? `reply-batch:${parent.user_id}:${input.parentId}:${Math.floor(Date.now() / 1_200_000)}` : `reply:${input.commentId}`,
  });
}
