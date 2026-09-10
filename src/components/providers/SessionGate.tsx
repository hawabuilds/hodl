"use client";

import dynamic from "next/dynamic";
import {useCallback, useMemo, useState, type ReactNode} from "react";
import {
  SessionContext,
  hasPrivySessionHint,
  isPrivyOAuthReturn,
  type Session,
} from "@/lib/session";

/**
 * Keeps the wallet stack off the landing page.
 *
 * Privy and wagmi are about a megabyte of JavaScript, and they were loaded on
 * every visit — including a first-time visitor reading a headline and two
 * lines of copy, for whom none of it does anything yet. Downloading, parsing
 * and booting that (Privy also makes two network calls and opens an iframe
 * before it can say whether anyone is signed in) was most of the wait on a
 * cold open.
 *
 * So load it when it is actually needed, which is any of:
 *
 *   - this browser has signed in before, so we must know who they are before
 *     painting, or a signed-in visitor gets shown the landing page;
 *   - Privy is mid-OAuth on this URL and the handshake needs its provider
 *     mounted to complete;
 *   - someone pressed "Continue with X".
 *
 * A stranger on the landing page hits none of these and pays for none of it.
 */
const LazyWalletStack = dynamic(
  () => import("./WalletStack").then((m) => m.WalletStack),
  {ssr: false},
);

/** The session before Privy exists: known-anonymous, and able to summon it. */
function useDeferredSession(activate: () => void): Session {
  const login = useCallback(() => activate(), [activate]);

  return useMemo(
    () => ({
      ready: true,
      authenticated: false,
      user: null,
      login,
      logout: () => {},
      mode: "privy",
      getEmbeddedProvider: async () => null,
      sendEmbeddedTransaction: null,
      exportEmbeddedWallet: null,
      getAccessToken: async () => null,
    }),
    [login],
  );
}

export function SessionGate({children}: {children: ReactNode}) {
  /**
   * Decided once, during the first client render rather than in an effect.
   *
   * An effect would run after paint, so a signed-in visitor would render one
   * frame as anonymous — long enough for AppShell's guard to bounce them to
   * the landing page.
   */
  const [loaded, setLoaded] = useState(
    () => hasPrivySessionHint() || isPrivyOAuthReturn(),
  );
  const [autoLogin, setAutoLogin] = useState(false);

  const activate = useCallback(() => {
    setAutoLogin(true);
    setLoaded(true);
  }, []);

  const deferred = useDeferredSession(activate);

  if (loaded) return <LazyWalletStack autoLogin={autoLogin}>{children}</LazyWalletStack>;

  return (
    <SessionContext.Provider value={deferred}>{children}</SessionContext.Provider>
  );
}
