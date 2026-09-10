"use client";

import {useCallback, useEffect, useMemo, useRef, type ReactNode} from "react";
import {PrivyProvider, usePrivy, useWallets} from "@privy-io/react-auth";
import {useDisconnect} from "wagmi";
import {useTheme} from "@/hooks/useTheme";
import {RH_MAINNET_ID, robinhoodMainnet} from "@/config/chain";
import {PRIVY_APP_ID} from "@/lib/env";
import {SessionContext, type AppUser, type EmbeddedSendTx, type Session} from "@/lib/session";

export function PrivySessionProvider({
  children,
  autoLogin = false,
}: {
  children: ReactNode;
  /**
   * Open the login flow as soon as Privy is ready.
   *
   * Set when the provider was mounted *by* a press on "Continue with X": the
   * press happened before Privy existed, so the intent has to be carried
   * across the load rather than lost with it.
   */
  autoLogin?: boolean;
}) {
  const {theme} = useTheme();

  // Never key this provider on theme. A remount mid-OAuth drops the callback
  // after X Allow and sends the user around the login loop again.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter"],
        embeddedWallets: {
          ethereum: {createOnLogin: "users-without-wallets"},
          // 4663 is not in Privy's fiat catalog. Fiat-primary leaves
          // "Estimated fee" on a skeleton forever; native ETH always computes.
          priceDisplay: {primary: "native-token", secondary: null},
        },
        // Without these an embedded wallet defaults to Ethereum mainnet, and
        // every transaction would be signed for the wrong chain.
        defaultChain: robinhoodMainnet,
        supportedChains: [robinhoodMainnet],
        appearance: {
          theme,
          accentColor: "#6860FF",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <PrivyBridge autoLogin={autoLogin}>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({
  children,
  autoLogin,
}: {
  children: ReactNode;
  autoLogin: boolean;
}) {
  const {
    ready,
    authenticated,
    user,
    login,
    logout: privyLogout,
    exportWallet,
    getAccessToken,
    sendTransaction,
  } = usePrivy();
  const {disconnect} = useDisconnect();
  const {wallets} = useWallets();
  const syncedRef = useRef<string | null>(null);

  const embeddedWallet =
    user?.wallet?.address ??
    wallets.find((w) => w.walletClientType === "privy")?.address ??
    null;

  // Resume the press that mounted this provider. Guarded by a ref because
  // `login` opens a redirect and must not be called twice on a re-render.
  const autoLoginFired = useRef(false);
  useEffect(() => {
    if (!autoLogin || autoLoginFired.current) return;
    if (!ready || authenticated) return;
    autoLoginFired.current = true;
    login({loginMethods: ["twitter"]});
  }, [autoLogin, ready, authenticated, login]);

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

  const sendEmbeddedTransaction = useCallback(
    async (tx: EmbeddedSendTx): Promise<`0x${string}`> => {
      if (privyWallet && typeof privyWallet.switchChain === "function") {
        try {
          await privyWallet.switchChain(tx.chainId || RH_MAINNET_ID);
        } catch {
          // Still send — defaultChain is Robinhood 4663.
        }
      }
      const result = await sendTransaction(
        {
          to: tx.to,
          data: tx.data,
          value: tx.value,
          chainId: tx.chainId,
          gasLimit: tx.gasLimit,
          ...(tx.maxFeePerGas && tx.maxPriorityFeePerGas != null
            ? {
                maxFeePerGas: tx.maxFeePerGas,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
              }
            : tx.gasPrice
              ? {gasPrice: tx.gasPrice}
              : {}),
        },
        {uiOptions: {showWalletUIs: true}},
      );
      return result.hash;
    },
    [privyWallet, sendTransaction],
  );

  const exportEmbeddedWallet = useCallback(async () => {
    await exportWallet();
  }, [exportWallet]);

  const logout = useCallback(() => {
    disconnect();
    void privyLogout();
  }, [disconnect, privyLogout]);

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
      login: () => login({loginMethods: ["twitter"]}),
      logout,
      mode: "privy",
      getEmbeddedProvider,
      sendEmbeddedTransaction,
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
      sendEmbeddedTransaction,
      exportEmbeddedWallet,
      fetchAccessToken,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
