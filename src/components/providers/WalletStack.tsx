"use client";

import type {ReactNode} from "react";
import {PrivySessionProvider} from "./PrivySession";
import {WalletProvider} from "./WalletProvider";

/**
 * wagmi and Privy together, as one lazily-loaded unit.
 *
 * They ship as one chunk on purpose: PrivyBridge calls wagmi's `useDisconnect`,
 * so Privy can never mount without wagmi above it, and splitting them would
 * only buy two round trips instead of one.
 */
export function WalletStack({
  children,
  autoLogin,
}: {
  children: ReactNode;
  autoLogin: boolean;
}) {
  return (
    <WalletProvider>
      <PrivySessionProvider autoLogin={autoLogin}>{children}</PrivySessionProvider>
    </WalletProvider>
  );
}
