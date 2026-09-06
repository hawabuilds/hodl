"use client";

import {useQuery} from "@tanstack/react-query";
import type {Profile} from "@/lib/types";
import {useSession} from "@/lib/session";
import {useUser} from "./useUser";

/** Resolves handles to profiles. Skipped entirely when there are none. */
export function usePeople(handles: string[], enabled = true) {
  const key = [...handles].sort().join(",");

  const query = useQuery({
    queryKey: ["people", key],
    enabled: enabled && handles.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/people?handles=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error("Could not load those profiles.");
      return (await res.json()) as {people: Profile[]};
    },
  });

  return {
    people: handles.length === 0 ? [] : (query.data?.people ?? []),
    isLoading: enabled && handles.length > 0 && query.isLoading,
  };
}

/** Who follows the signed-in account. Seeded until there is a follow table. */
export function useMyFollowers(enabled = true) {
  const session = useSession();
  const user = useUser();
  const query = useQuery({
    queryKey: ["my-followers", user.user?.id ?? ""],
    enabled: enabled && user.authenticated,
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return {followers: [] as Profile[], seeded: false};
      const res = await fetch("/api/me/social", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!res.ok) throw new Error("Could not load your followers.");
      return (await res.json()) as {followers: Profile[]; seeded: boolean};
    },
  });

  return {
    followers: query.data?.followers ?? [],
    isLoading: enabled && query.isLoading,
  };
}
