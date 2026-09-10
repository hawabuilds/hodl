"use client";

import {useCallback, useEffect, useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {
  readCachedMe,
  readProfileEdits,
  writeCachedMe,
  writeProfileEdits,
  type ProfileEdits,
} from "@/lib/localStore";
import type {SocialLinks} from "@/lib/types";
import {useSession} from "@/lib/session";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";

const EMPTY: ProfileEdits = {displayName: null, bio: null, socials: {}};

interface MeRow {
  displayName: string | null;
  handle: string | null;
  pfpUrl: string | null;
  wallet: string | null;
  bio: string;
  portfolioPublic: boolean;
}

export function useMe() {
  const user = useUser();
  const session = useSession();
  const [edits] = useLocalStore<ProfileEdits>(readProfileEdits, EMPTY);
  const cached = useMemo(() => readCachedMe(), []);

  const remote = useQuery({
    queryKey: ["me-profile", user.user?.id ?? ""],
    enabled: user.authenticated,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    queryFn: async (): Promise<MeRow> => {
      const token = await session.getAccessToken();
      if (!token) {
        return {
          displayName: user.displayName,
          handle: user.handle,
          pfpUrl: user.pfpUrl,
          wallet: user.embeddedWallet,
          bio: "",
          portfolioPublic: true,
        };
      }
      const res = await fetch("/api/me/profile", {
        headers: {authorization: `Bearer ${token}`},
      });
      if (!res.ok) throw new Error("Could not load your profile.");
      return (await res.json()) as MeRow;
    },
  });

  const displayName =
    edits.displayName ??
    remote.data?.displayName ??
    cached?.displayName ??
    user.displayName ??
    "You";
  const handle = remote.data?.handle ?? cached?.handle ?? user.handle;
  const pfpUrl = remote.data?.pfpUrl ?? cached?.pfpUrl ?? user.pfpUrl;
  const wallet = remote.data?.wallet ?? cached?.wallet ?? user.embeddedWallet;
  const bio = edits.bio ?? remote.data?.bio ?? cached?.bio ?? "";
  const portfolioPublic = remote.data?.portfolioPublic !== false;

  useEffect(() => {
    if (!pfpUrl && displayName === "You") return;
    writeCachedMe({displayName, handle, pfpUrl, wallet, bio});
  }, [displayName, handle, pfpUrl, wallet, bio]);

  useEffect(() => {
    if (!user.authenticated || !remote.isSuccess) return;
    if (remote.data?.handle || !user.handle) return;
    void session.getAccessToken().then(async (token) => {
      if (!token) return;
      await fetch("/api/me/profile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          handle: user.handle,
          displayName: user.displayName,
          pfpUrl: user.pfpUrl,
          wallet: user.embeddedWallet,
        }),
      });
      await remote.refetch();
    });
  }, [remote, session, user]);

  const socials: SocialLinks = {
    x: edits.socials.x ?? (handle ? `https://x.com/${handle}` : null),
    telegram: edits.socials.telegram ?? null,
    website: edits.socials.website ?? null,
    discord: edits.socials.discord ?? null,
  };

  const save = useCallback(
    (next: ProfileEdits) => {
      writeProfileEdits(next);
      void session.getAccessToken().then(async (token) => {
        if (!token) return;
        await fetch("/api/me/profile", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            handle: user.handle,
            displayName: next.displayName ?? user.displayName,
            pfpUrl: user.pfpUrl,
            wallet: user.embeddedWallet,
            bio: next.bio ?? null,
            socials: next.socials,
          }),
        });
      });
    },
    [session, user],
  );

  const savePortfolioPublic = useCallback(
    (next: boolean) => {
      void session.getAccessToken().then(async (token) => {
        if (!token) return;
        await fetch("/api/me/profile", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({portfolioPublic: next}),
        });
        await remote.refetch();
      });
    },
    [remote, session],
  );

  return {
    handle,
    displayName,
    bio,
    pfpUrl,
    wallet,
    socials,
    portfolioPublic,
    edits,
    save,
    savePortfolioPublic,
  };
}
