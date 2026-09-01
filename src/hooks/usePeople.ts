"use client";

import {useQuery} from "@tanstack/react-query";
import type {Profile} from "@/lib/types";

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
  const query = useQuery({
    queryKey: ["my-followers"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/me/social");
      if (!res.ok) throw new Error("Could not load your followers.");
      return (await res.json()) as {followers: Profile[]; seeded: boolean};
    },
  });

  return {
    followers: query.data?.followers ?? [],
    isLoading: enabled && query.isLoading,
  };
}
