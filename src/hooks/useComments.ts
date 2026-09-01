"use client";

import {useCallback, useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {readLocalComments, writeLocalComment} from "@/lib/localStore";
import type {
  AssetComment,
  AssetKind,
  CommentThread,
} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";

/**
 * Groups a flat, oldest-first list into one-level threads.
 *
 * A reply whose root fell outside the fetched window is promoted to a root of
 * its own rather than dropped, so a long-running asset never silently loses
 * comments off the top.
 */
function buildThreads(comments: AssetComment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  const orphans: AssetComment[] = [];

  for (const comment of comments) {
    if (!comment.parentId) threads.set(comment.id, {root: comment, replies: []});
  }

  for (const comment of comments) {
    if (!comment.parentId) continue;
    const thread = threads.get(comment.parentId);
    if (thread) thread.replies.push(comment);
    else orphans.push(comment);
  }

  return [
    ...Array.from(threads.values()),
    ...orphans.map((root) => ({root, replies: []})),
  ].sort(
    (a, b) =>
      new Date(a.root.createdAt).getTime() - new Date(b.root.createdAt).getTime(),
  );
}

/**
 * Comments for one asset.
 *
 * Seeded discussion comes from the server; anything posted here is written to
 * this browser and merged in. When a database lands, the merge collapses into a
 * POST and nothing above this hook changes.
 */
export function useComments(kind: AssetKind, assetId: string) {
  const {authenticated, handle, displayName, pfpUrl} = useUser();

  const remote = useQuery({
    queryKey: ["comments", kind, assetId],
    queryFn: async () => {
      const res = await fetch(`/api/asset/${kind}/${assetId}/comments`);
      if (!res.ok) throw new Error("Could not load comments.");
      return (await res.json()) as {comments: AssetComment[]; localOnly: boolean};
    },
  });

  const readLocal = useCallback(
    () => readLocalComments(assetId),
    [assetId],
  );
  const [local] = useLocalStore<AssetComment[]>(readLocal, []);

  const comments = useMemo(() => {
    const merged = [...(remote.data?.comments ?? []), ...local];
    return merged.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [remote.data, local]);

  const threads = useMemo(() => buildThreads(comments), [comments]);

  const post = useCallback(
    ({body, parentId}: {body: string; parentId: string | null}) => {
      const trimmed = body.trim();
      if (!trimmed || !authenticated) return;
      writeLocalComment({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        assetId,
        parentId,
        author: {
          handle: handle ?? "you",
          displayName: displayName ?? "You",
          pfpUrl,
        },
        body: trimmed.slice(0, 500),
        createdAt: new Date().toISOString(),
      });
    },
    [assetId, authenticated, handle, displayName, pfpUrl],
  );

  return {
    comments,
    threads,
    isLoading: remote.isLoading,
    error: remote.error ? (remote.error as Error).message : null,
    canPost: authenticated,
    localOnly: remote.data?.localOnly ?? true,
    post,
  };
}
