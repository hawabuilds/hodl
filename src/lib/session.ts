"use client";

import {createContext, useContext} from "react";

export interface AppUser {
  /** Stable id. Privy DID in production, a local id in demo mode. */
  id: string;
  handle: string | null;
  displayName: string;
  pfpUrl: string | null;
  embeddedWallet: string | null;
}

export interface EmbeddedProvider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
}

export interface Session {
  ready: boolean;
  authenticated: boolean;
  user: AppUser | null;
  login: () => void;
  logout: () => void;
  /** "demo" when NEXT_PUBLIC_PRIVY_APP_ID is unset and login is faked locally. */
  mode: "privy" | "demo";
  /**
   * EIP-1193 provider for the embedded wallet. Exposed here rather than
   * imported from Privy directly so the demo provider — which has no Privy
   * context to read — can return null instead of throwing.
   */
  getEmbeddedProvider: () => Promise<EmbeddedProvider | null>;
  /**
   * Opens Privy's export flow for the embedded wallet. Null in demo mode,
   * where there is no real wallet to back up.
   */
  exportEmbeddedWallet: (() => Promise<void>) | null;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <Providers>");
  }
  return session;
}
