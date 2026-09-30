"use client";

import {useCallback} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {MARKET_REFRESH_MS} from "@/config/market";
import {DEFAULT_ALERT_PREFS, type Activity, type AlertPrefs} from "@/lib/alerts";
import {useSession} from "@/lib/session";
import {useUser} from "./useUser";

/**
 * The Following feed and the bell, polled on the Trending list's clock.
 *
 * Mounted once by the desktop shell; the rail, the bell and the pop-ups all
 * read the same query, so there is one request every ten seconds however many
 * of them are on screen.
 */

const EMPTY: Activity = {
  following: [],
  bell: [],
  followingSeenAt: null,
  bellSeenAt: null,
  followingCount: 0,
};

async function authHeaders(getToken: () => Promise<string | null>): Promise<HeadersInit> {
  const token = await getToken();
  return token ? {authorization: `Bearer ${token}`} : {};
}

export function useActivity() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const userId = user.user?.id ?? "";

  const query = useQuery({
    queryKey: ["activity", userId],
    enabled: user.authenticated,
    refetchInterval: MARKET_REFRESH_MS,
    retry: 1,
    queryFn: async (): Promise<Activity & {prefs?: AlertPrefs}> => {
      const res = await fetch("/api/me/activity", {
        headers: await authHeaders(session.getAccessToken),
        cache: "no-store",
      });
      // Demo mode has no server identity: nobody to read activity for.
      if (res.status === 401) return EMPTY;
      if (!res.ok) throw new Error("Couldn't load activity.");
      return (await res.json()) as Activity & {prefs?: AlertPrefs};
    },
  });

  const markSeen = useCallback(
    (which: "following" | "bell", at: string) => {
      const field = which === "following" ? "followingSeenAt" : "bellSeenAt";
      const key = ["activity", userId];
      const current = queryClient.getQueryData<Activity>(key);
      const previous = current?.[field];
      if (previous && Date.parse(previous) >= Date.parse(at)) return;
      queryClient.setQueryData<Activity>(key, (data) => (data ? {...data, [field]: at} : data));
      void (async () => {
        await fetch("/api/me/activity/seen", {
          method: "POST",
          headers: {
            ...(await authHeaders(session.getAccessToken)),
            "content-type": "application/json",
          },
          body: JSON.stringify({which, at}),
        }).catch(() => undefined);
      })();
    },
    [queryClient, session, userId],
  );

  return {
    activity: query.data ?? null,
    isLoading: user.authenticated && query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
    markSeen,
  };
}

/**
 * Settings → Alerts. Saved per user; every reader of the query sees a change
 * the moment it is made, so switching pop-ups off stops the next one.
 */
export function useAlertPrefs() {
  const session = useSession();
  const user = useUser();
  const queryClient = useQueryClient();
  const userId = user.user?.id ?? "";

  const query = useQuery({
    queryKey: ["alert-prefs", userId],
    enabled: user.authenticated,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<AlertPrefs> => {
      const res = await fetch("/api/me/alerts", {headers: await authHeaders(session.getAccessToken)});
      if (res.status === 401) return {...DEFAULT_ALERT_PREFS};
      if (!res.ok) throw new Error("Couldn't load alerts.");
      return ((await res.json()) as {prefs: AlertPrefs}).prefs;
    },
  });

  const save = useCallback(
    async (patch: Partial<AlertPrefs>) => {
      const key = ["alert-prefs", userId];
      const before = queryClient.getQueryData<AlertPrefs>(key) ?? DEFAULT_ALERT_PREFS;
      queryClient.setQueryData<AlertPrefs>(key, {...before, ...patch});
      const res = await fetch("/api/me/alerts", {
        method: "PUT",
        headers: {
          ...(await authHeaders(session.getAccessToken)),
          "content-type": "application/json",
        },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (!res?.ok) {
        queryClient.setQueryData<AlertPrefs>(key, before);
        throw new Error("Couldn't save. Try again.");
      }
    },
    [queryClient, session, userId],
  );

  return {
    prefs: query.data ?? DEFAULT_ALERT_PREFS,
    loaded: query.isSuccess,
    error: query.error,
    save,
  };
}
