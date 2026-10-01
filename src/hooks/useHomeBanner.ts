"use client";

import {useCallback, useEffect, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useSession} from "@/lib/session";
import {useUser} from "./useUser";

/** Browser copy of "closed", for everyone — and the only copy when signed out. */
const LOCAL_KEY = "rwa.home-banner-closed";

function readLocal(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, "1");
  } catch {
    // Blocked storage: closed for this visit only.
  }
}

/**
 * Whether the mobile Home banner shows, and closing it. Closed is remembered
 * in the browser, and on the person's profile when signed in so it stays
 * closed on their other devices. Hidden until both are known, so it never
 * flashes up for someone who already closed it.
 */
export function useHomeBanner(): {open: boolean; close: () => void} {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const userId = user.user?.id ?? "";
  const [mounted, setMounted] = useState(false);
  const [closedHere, setClosedHere] = useState(false);

  useEffect(() => {
    setClosedHere(readLocal());
    setMounted(true);
  }, []);

  const stored = useQuery({
    queryKey: ["home-banner", userId],
    enabled: user.authenticated && !user.isDemo,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<{closed: boolean}> => {
      const token = await session.getAccessToken();
      const res = await fetch("/api/me/banner", {
        headers: token ? {authorization: `Bearer ${token}`} : {},
        cache: "no-store",
      });
      if (!res.ok) return {closed: false};
      return (await res.json()) as {closed: boolean};
    },
  });

  const profileKnown = !user.authenticated || user.isDemo || !stored.isPending;
  const open = mounted && !closedHere && profileKnown && !stored.data?.closed;

  const close = useCallback(() => {
    writeLocal();
    setClosedHere(true);
    if (!user.authenticated || user.isDemo) return;
    queryClient.setQueryData(["home-banner", userId], {closed: true});
    void (async () => {
      try {
        const token = await session.getAccessToken();
        await fetch("/api/me/banner", {
          method: "POST",
          headers: token ? {authorization: `Bearer ${token}`} : {},
        });
      } catch {
        // The browser copy still keeps it closed here.
      }
    })();
  }, [queryClient, session, user.authenticated, user.isDemo, userId]);

  return {open, close};
}
