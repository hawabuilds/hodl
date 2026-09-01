"use client";

import {useCallback} from "react";
import {
  readProfileEdits,
  writeProfileEdits,
  type ProfileEdits,
} from "@/lib/localStore";
import type {SocialLinks} from "@/lib/types";
import {useLocalStore} from "./useLocalStore";
import {useUser} from "./useUser";

const EMPTY: ProfileEdits = {displayName: null, bio: null, socials: {}};

/**
 * The signed-in person as their own profile.
 *
 * Identity comes from Privy; the editable parts are stored locally and layered
 * on top, so an edited display name survives a reload without pretending there
 * is a users table behind it yet.
 */
export function useMe() {
  const user = useUser();
  const [edits] = useLocalStore<ProfileEdits>(readProfileEdits, EMPTY);

  const socials: SocialLinks = {
    x: edits.socials.x ?? (user.handle ? `https://x.com/${user.handle}` : null),
    telegram: edits.socials.telegram ?? null,
    website: edits.socials.website ?? null,
    discord: edits.socials.discord ?? null,
  };

  const save = useCallback((next: ProfileEdits) => writeProfileEdits(next), []);

  return {
    handle: user.handle,
    displayName: edits.displayName ?? user.displayName ?? "You",
    bio: edits.bio ?? "",
    pfpUrl: user.pfpUrl,
    wallet: user.embeddedWallet,
    socials,
    edits,
    save,
  };
}
