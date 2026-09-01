"use client";

import { useSession } from "@/lib/session";

/**
 * The player as the UI needs them: X identity plus their embedded wallet.
 */
export function useUser() {
  const { ready, authenticated, user, login, logout, mode } = useSession();

  return {
    ready,
    authenticated,
    user,
    handle: user?.handle ?? null,
    displayName: user?.displayName ?? null,
    pfpUrl: user?.pfpUrl ?? null,
    embeddedWallet: user?.embeddedWallet ?? null,
    isDemo: mode === "demo",
    login,
    logout,
  };
}
