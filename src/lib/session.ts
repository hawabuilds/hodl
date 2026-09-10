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

/**
 * Unsigned write Privy's confirmation sheet needs to render "Estimated fee".
 * Built by `privyUnsignedTx` — gasLimit + chainId + gasPrice/EIP-1559 fields.
 */
export type EmbeddedSendTx = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  chainId: number;
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

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
   * Privy's `sendTransaction` so the approval sheet sees gasLimit, chainId,
   * and fee fields. Null in demo mode.
   */
  sendEmbeddedTransaction: ((tx: EmbeddedSendTx) => Promise<`0x${string}`>) | null;
  /**
   * Opens Privy's export flow for the embedded wallet. Null in demo mode,
   * where there is no real wallet to back up.
   */
  exportEmbeddedWallet: (() => Promise<void>) | null;
  /** Returns a Privy access token for authenticated API calls, or null. */
  getAccessToken: () => Promise<string | null>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <Providers>");
  }
  return session;
}

/**
 * Whether this browser looks like it has ever signed in.
 *
 * Used to decide if Privy has to load before first paint. Deliberately broad:
 * a false positive only means loading Privy as eagerly as we always did, while
 * a false negative would treat a signed-in visitor as a stranger and bounce
 * them to the landing page. Any `privy:` key counts, because the access token
 * expires while the refresh token and connection list outlive it.
 */
export function hasPrivySessionHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      if (isPrivySessionKey(window.localStorage.key(i))) return true;
    }
  } catch {
    // Private mode can throw on access; fall through to the cookie.
  }
  return document.cookie.includes("privy-token");
}

/**
 * Keys that mean a session, as opposed to a device.
 *
 * Only the credentials count. Privy writes `privy:caid`, `privy:sent:…` and
 * `privy:connections` whenever it boots, signed in or not, so anything broader
 * than this makes every visit after the first one eager — which is exactly the
 * visitor the deferral is for. Match token-shaped keys, so a rename to
 * something like `privy:access_token` still counts, and nothing else.
 */
export function isPrivySessionKey(key: string | null): boolean {
  if (!key?.startsWith("privy:")) return false;
  return key.includes("token");
}

/** True while Privy is finishing an X OAuth redirect on this page. */
export function isPrivyOAuthReturn(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.has("privy_oauth_code") ||
    params.has("privy_oauth_state") ||
    params.has("privy_oauth_provider")
  );
}
