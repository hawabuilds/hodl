"use client";

import {useCallback, useEffect, useMemo, useRef, type ReactNode} from "react";
import {PrivyProvider, usePrivy, useWallets} from "@privy-io/react-auth";
import {useTheme} from "@/hooks/useTheme";
import {robinhoodMainnet} from "@/config/chain";
import {PRIVY_APP_ID} from "@/lib/env";
import {SessionContext, type AppUser, type Session} from "@/lib/session";

export function PrivySessionProvider({children}: {children: ReactNode}) {
  const {theme} = useTheme();

  return (
    <PrivyProvider
      key={theme}
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter", "email"],
        embeddedWallets: {
          ethereum: {createOnLogin: "users-without-wallets"},
        },
        // Without these an embedded wallet defaults to Ethereum mainnet, and
        // every transaction would be signed for the wrong chain.
        defaultChain: robinhoodMainnet,
        supportedChains: [robinhoodMainnet],
        appearance: {
          theme,
          accentColor: "#00C805",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({children}: {children: ReactNode}) {
  const {ready, authenticated, user, login, logout, exportWallet, getAccessToken} =
    usePrivy();
  const {wallets} = useWallets();
  const syncedRef = useRef<string | null>(null);

  const embeddedWallet =
    user?.wallet?.address ??
    wallets.find((w) => w.walletClientType === "privy")?.address ??
    null;

  const appUser: AppUser | null = useMemo(() => {
    if (!user) return null;
    const twitter = user.twitter;
    return {
      id: user.id,
      handle: twitter?.username ?? null,
      displayName: twitter?.name ?? twitter?.username ?? "Trader",
      // Privy returns the 48px variant; drop the suffix for a crisp avatar.
      pfpUrl: twitter?.profilePictureUrl?.replace("_normal", "") ?? null,
      embeddedWallet,
    };
  }, [user, embeddedWallet]);

  useEffect(() => {
    if (!authenticated || !appUser) {
      syncedRef.current = null;
      return;
    }
    if (syncedRef.current === appUser.id) return;
    syncedRef.current = appUser.id;

    void getAccessToken().then(async (token) => {
      if (!token) return;
      await fetch("/api/me/profile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          handle: appUser.handle,
          displayName: appUser.displayName,
          pfpUrl: appUser.pfpUrl,
          wallet: appUser.embeddedWallet,
        }),
      });
    });
  }, [authenticated, appUser, getAccessToken]);

  const privyWallet = wallets.find((w) => w.walletClientType === "privy");

  const getEmbeddedProvider = useCallback(async () => {
    if (!privyWallet) return null;
    try {
      const provider = await privyWallet.getEthereumProvider();
      return {request: provider.request.bind(provider)};
    } catch {
      return null;
    }
  }, [privyWallet]);

  const exportEmbeddedWallet = useCallback(async () => {
    await exportWallet();
  }, [exportWallet]);

  const fetchAccessToken = useCallback(async () => {
    try {
      return await getAccessToken();
    } catch {
      return null;
    }
  }, [getAccessToken]);

  const value: Session = useMemo(
    () => ({
      ready,
      authenticated,
      user: appUser,
      login: () => login(),
      logout: () => void logout(),
      mode: "privy",
      getEmbeddedProvider,
      exportEmbeddedWallet,
      getAccessToken: fetchAccessToken,
    }),
    [
      ready,
      authenticated,
      appUser,
      login,
      logout,
      getEmbeddedProvider,
      exportEmbeddedWallet,
      fetchAccessToken,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
