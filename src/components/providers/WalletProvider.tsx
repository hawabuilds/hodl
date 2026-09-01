"use client";

import {useState, type ReactNode} from "react";
import {WagmiProvider} from "wagmi";
import {getWagmiConfig} from "@/config/wagmi";

/**
 * Wraps the app in wagmi. Sits inside the react-query provider because wagmi's
 * hooks are built on react-query and expect a client above them.
 */
export function WalletProvider({children}: {children: ReactNode}) {
  const [config] = useState(getWagmiConfig);

  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
