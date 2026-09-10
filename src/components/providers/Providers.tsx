"use client";

import {useState, type ReactNode} from "react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {isPrivyConfigured} from "@/lib/env";
import {DemoSessionProvider} from "./DemoSession";
import {SessionGate} from "./SessionGate";
import {ThemeProvider} from "./ThemeProvider";
import {WalletProvider} from "./WalletProvider";

export function Providers({children}: {children: ReactNode}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The market moves on a one-minute cadence, so anything older than
            // that is worth replacing when a view remounts.
            staleTime: 30_000,
            // Kept well past the stale window so moving between tabs paints
            // from cache and refreshes behind you. At the default five minutes
            // the data was dropped outright, and coming back to a tab meant
            // watching a skeleton for something already fetched twice.
            gcTime: 30 * 60_000,
            // A remount with cached data renders it immediately rather than
            // flashing a loading state before the same rows reappear.
            placeholderData: <T,>(previous: T) => previous,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {isPrivyConfigured ? (
          // wagmi rides along inside the gate — see SessionGate for why the
          // wallet stack is not mounted until something actually needs it.
          <SessionGate>{children}</SessionGate>
        ) : (
          <WalletProvider>
            <DemoSessionProvider>{children}</DemoSessionProvider>
          </WalletProvider>
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
