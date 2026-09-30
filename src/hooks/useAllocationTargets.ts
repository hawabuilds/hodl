"use client";

import {useCallback} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {useLocalStore} from "@/hooks/useLocalStore";
import {useUser} from "@/hooks/useUser";
import {cleanTargets} from "@/lib/allocation";
import {readAllocationTargets, writeAllocationTargets} from "@/lib/localStore";
import {useSession} from "@/lib/session";

/**
 * The owner's allocation targets. Signed in, they are saved on the profile
 * (so they follow the account between devices); in demo mode, in the browser.
 */
export function useAllocationTargets() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const [local] = useLocalStore<Record<string, number>>(readAllocationTargets, {});
  const signedIn = user.authenticated && session.mode === "privy";
  const userId = user.user?.id ?? "";

  const remote = useQuery({
    queryKey: ["allocation-targets", userId],
    enabled: signedIn,
    staleTime: Infinity,
    queryFn: async () => {
      const token = await session.getAccessToken();
      if (!token) return {};
      const res = await fetch("/api/me/targets", {headers: {authorization: `Bearer ${token}`}});
      if (!res.ok) throw new Error("Couldn't load your targets.");
      return cleanTargets(((await res.json()) as {targets?: unknown}).targets) ?? {};
    },
  });

  const save = useCallback(
    async (targets: Record<string, number>) => {
      if (!signedIn) {
        writeAllocationTargets(targets);
        return;
      }
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in to save targets.");
      const res = await fetch("/api/me/targets", {
        method: "PUT",
        headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
        body: JSON.stringify({targets}),
      });
      const body = (await res.json().catch(() => ({}))) as {targets?: unknown; error?: string};
      if (!res.ok) throw new Error(body.error ?? "Couldn't save your targets.");
      queryClient.setQueryData(["allocation-targets", userId], cleanTargets(body.targets) ?? targets);
    },
    [queryClient, session, signedIn, userId],
  );

  return {
    targets: signedIn ? (remote.data ?? {}) : local,
    loading: signedIn && remote.isPending,
    save,
  };
}
