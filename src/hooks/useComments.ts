"use client";

import {useCallback, useMemo} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {readLocalComments, writeLocalComment} from "@/lib/localStore";
import {useSession} from "@/lib/session";
import type {
  AssetComment,
  AssetKind,
  CommentThread,
} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";
import {requestPushIntent} from "@/components/PushPrompt";

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
 * Live comments come from Supabase. Anything posted while the database is
 * down is written to this browser and merged in.
 */
export function useComments(kind: AssetKind, assetId: string) {
  const {authenticated, handle, displayName, pfpUrl} = useUser();
  const session = useSession();
  const queryClient = useQueryClient();

  const remote = useQuery({
    queryKey: ["comments", kind, assetId, authenticated],
    queryFn: async () => {
      // Signed in, the token decides two things the anonymous view cannot
      // know: which comments you have liked, and whether you may post.
      const token = authenticated ? await session.getAccessToken() : null;
      const res = await fetch(`/api/asset/${kind}/${assetId}/comments`, {
        headers: token ? {authorization: `Bearer ${token}`} : undefined,
      });
      if (!res.ok) throw new Error("Could not load comments.");
      return (await res.json()) as {
        comments: AssetComment[];
        localOnly: boolean;
        /** Whether the caller holds this asset, which is what posting needs. */
        canPost?: boolean;
      };
    },
    retry: false,
    // Comments are a conversation: new ones should arrive without a reload.
    refetchInterval: 20_000,
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
      requestPushIntent("comment");
      if (remote.data?.localOnly === false) {
        void session.getAccessToken().then(async (token) => {
          if (!token) return;
          await fetch(`/api/asset/${kind}/${assetId}/comments`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({body: trimmed.slice(0, 500), parentId}),
          });
          await queryClient.invalidateQueries({queryKey: ["comments", kind, assetId, authenticated]});
        });
        return;
      }
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
        likes: 0,
        liked: false,
        position: null,
      });
    },
    [assetId, authenticated, handle, displayName, pfpUrl, kind, queryClient, remote.data?.localOnly, session],
  );

  /**
   * Like or unlike, applied locally first.
   *
   * A heart that waits on a round trip feels broken, so the cache is updated
   * immediately and reconciled with the server's count when it answers. On a
   * failure the list is refetched rather than rolled back by hand — the
   * server's tally is the truth, and re-reading it is simpler than trying to
   * reconstruct what it was.
   */
  const toggleLike = useCallback(
    (commentId: string) => {
      if (!authenticated || remote.data?.localOnly !== false) return;

      const key = ["comments", kind, assetId, authenticated];
      let next = true;
      queryClient.setQueryData(key, (current: typeof remote.data) => {
        if (!current) return current;
        return {
          ...current,
          comments: current.comments.map((comment) => {
            if (comment.id !== commentId) return comment;
            next = !comment.liked;
            return {
              ...comment,
              liked: next,
              likes: Math.max(0, comment.likes + (next ? 1 : -1)),
            };
          }),
        };
      });

      void (async () => {
        try {
          const token = await session.getAccessToken();
          if (!token) return;
          const res = await fetch(`/api/comments/${commentId}/like`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({liked: next}),
          });
          if (!res.ok) throw new Error("like failed");
          const result = (await res.json()) as {likes: number; liked: boolean};
          queryClient.setQueryData(key, (current: typeof remote.data) => {
            if (!current) return current;
            return {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === commentId
                  ? {...comment, likes: result.likes, liked: result.liked}
                  : comment,
              ),
            };
          });
        } catch {
          await queryClient.invalidateQueries({queryKey: key});
        }
      })();
    },
    [assetId, authenticated, kind, queryClient, remote.data?.localOnly, session],
  );

  return {
    comments,
    threads,
    isLoading: remote.isLoading,
    error: remote.error ? (remote.error as Error).message : null,
    retry: () => void remote.refetch(),
    /**
     * Posting needs a holding once the database is live. Against the seeded
     * cast anyone signed in may post, because those posts never leave the
     * browser anyway.
     */
    canPost:
      authenticated &&
      (remote.data?.localOnly === false ? Boolean(remote.data.canPost) : true),
    /** Liking is open to anyone signed in; only speaking needs a position. */
    canLike: authenticated && remote.data?.localOnly === false,
    /** Signed in but not holding — the composer says so rather than just greying out. */
    needsPosition:
      authenticated && remote.data?.localOnly === false && !remote.data.canPost,
    localOnly: remote.data?.localOnly ?? true,
    post,
    toggleLike,
  };
}
