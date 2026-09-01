"use client";

import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react";
import {SessionContext, type AppUser, type Session} from "@/lib/session";

const STORAGE_KEY = "rwa.demo-user";

/**
 * Stand-in for Privy so the app is runnable before an app id exists. It only
 * ever activates when NEXT_PUBLIC_PRIVY_APP_ID is missing, and the login screen
 * labels itself as demo mode.
 */
const DEMO_USER: AppUser = {
  id: "demo:local-trader",
  handle: "you",
  displayName: "You",
  pfpUrl: null,
  embeddedWallet: "0x8F3c0000000000000000000000000000000c4A21",
};

export function DemoSessionProvider({children}: {children: ReactNode}) {
  const [authenticated, setAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAuthenticated(window.localStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  const login = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setAuthenticated(false);
  }, []);

  const value: Session = useMemo(
    () => ({
      ready,
      authenticated,
      user: authenticated ? DEMO_USER : null,
      login,
      logout,
      mode: "demo",
      getEmbeddedProvider: async () => null,
      exportEmbeddedWallet: null,
    }),
    [ready, authenticated, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
