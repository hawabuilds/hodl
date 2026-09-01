"use client";

import {useCallback} from "react";
import {useQuery} from "@tanstack/react-query";
import {isFollowing, readFollowing, toggleFollow} from "@/lib/localStore";
import type {Profile} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";

interface ProfileResponse {
  profile: Profile;
  followerHandles: string[];
  followingHandles: string[];
}

export function useProfile(handle: string) {
  const query = useQuery({
    queryKey: ["profile", handle.toLowerCase()],
    enabled: handle.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/profile/${encodeURIComponent(handle)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Could not load this profile.");
      return (await res.json()) as ProfileResponse;
    },
  });

  return {
    profile: query.data?.profile ?? null,
    followerHandles: query.data?.followerHandles ?? [],
    followingHandles: query.data?.followingHandles ?? [],
    isLoading: query.isLoading,
    notFound: query.data === null && !query.isLoading,
  };
}

/** Who this browser follows. Local until there is a follow graph to write to. */
export function useFollows() {
  const [following] = useLocalStore<string[]>(readFollowing, []);

  const toggle = useCallback((handle: string) => toggleFollow(handle), []);
  const has = useCallback(
    (handle: string) => following.includes(handle.toLowerCase()),
    [following],
  );

  return {following, has, toggle, isFollowing};
}
