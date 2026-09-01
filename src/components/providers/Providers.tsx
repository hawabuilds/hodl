"use client";

import {useState, type ReactNode} from "react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {isPrivyConfigured} from "@/lib/env";
import {DemoSessionProvider} from "./DemoSession";
import {PrivySessionProvider} from "./PrivySession";
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
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const Session = isPrivyConfigured ? PrivySessionProvider : DemoSessionProvider;

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <Session>{children}</Session>
        </WalletProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
