"use client";

import {useCallback, useEffect, useMemo, useRef} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {isFollowing, readFollowing, toggleFollow, writeFollowing} from "@/lib/localStore";
import type {Profile} from "@/lib/types";
import {useSession} from "@/lib/session";
import {errorText} from "@/lib/responseError";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";
import {requestPushIntent} from "@/components/PushPrompt";

interface ProfileResponse {
  profile: Profile;
  followerHandles: string[];
  followingHandles: string[];
  holdingsVisible?: boolean;
}

export function useProfile(handle: string) {
  const query = useQuery({
    queryKey: ["profile", handle.toLowerCase()],
    enabled: handle.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/profile/${encodeURIComponent(handle)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await errorText(res, "Could not load this profile."));
      return (await res.json()) as ProfileResponse;
    },
  });

  return {
    profile: query.data?.profile ?? null,
    followerHandles: query.data?.followerHandles ?? [],
    followingHandles: query.data?.followingHandles ?? [],
    holdingsVisible: query.data?.holdingsVisible !== false,
    isLoading: query.isLoading,
    notFound: query.data === null && !query.isLoading,
  };
}

/** Who this account follows. Server graph when signed in; local only in demo. */
export function useFollows() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const [localFollowing] = useLocalStore<string[]>(readFollowing, []);

  const remote = useQuery({
    queryKey: ["following", user.user?.id ?? ""],
    enabled: user.authenticated && session.mode === "privy",
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return [] as string[];
      const res = await fetch("/api/follows", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!res.ok) throw new Error("Could not load who you follow.");
      const data = (await res.json()) as {following: string[]};
      return (data.following ?? []).map((handle) => handle.toLowerCase());
    },
  });

  const signedIn = user.authenticated && session.mode === "privy";
  const following = useMemo(
    () =>
      signedIn
        ? (remote.data ?? [])
        : localFollowing.map((handle) => handle.toLowerCase()),
    [signedIn, remote.data, localFollowing],
  );

  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    if (!user.authenticated || session.mode !== "privy") return;
    if (!remote.isSuccess) return;
    const leftover = localFollowing
      .map((handle) => handle.replace(/^@/, "").toLowerCase())
      .filter((handle) => handle && !following.includes(handle));
    if (leftover.length === 0) {
      migrated.current = true;
      return;
    }
    migrated.current = true;
    void (async () => {
      const token = await session.getAccessToken();
      if (!token) return;
      for (const handle of leftover) {
        await fetch("/api/follows", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({handle, following: true}),
        });
      }
      writeFollowing([]);
      await queryClient.invalidateQueries({queryKey: ["following"]});
    })();
  }, [following, localFollowing, queryClient, remote.isSuccess, session, user.authenticated]);

  const toggle = useCallback(
    (handle: string) => {
      if (!user.authenticated || session.mode !== "privy") {
        const key = handle.replace(/^@/, "").toLowerCase();
        const next = !localFollowing.map((h) => h.toLowerCase()).includes(key);
        toggleFollow(handle);
        if (next) requestPushIntent("follow");
        return;
      }
      const key = handle.replace(/^@/, "").toLowerCase();
      const next = !following.includes(key);
      if (next) requestPushIntent("follow");
      void (async () => {
        const token = await session.getAccessToken();
        if (!token) return;
        const res = await fetch("/api/follows", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({handle, following: next}),
        });
        if (!res.ok) return;
        await queryClient.invalidateQueries({queryKey: ["following"]});
        await queryClient.invalidateQueries({queryKey: ["my-followers"]});
        await queryClient.invalidateQueries({queryKey: ["profile"]});
      })();
    },
    [following, localFollowing, queryClient, session, user.authenticated],
  );

  const has = useCallback(
    (handle: string) => following.includes(handle.replace(/^@/, "").toLowerCase()),
    [following],
  );

  return {following, has, toggle, isFollowing, isLoading: remote.isLoading};
}