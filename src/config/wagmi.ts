import {createConfig, http, type Config, type CreateConnectorFn} from "wagmi";
import {coinbaseWallet, injected, walletConnect} from "wagmi/connectors";
import {APP_NAME, APP_TAGLINE} from "@/config/app";
import {robinhoodMainnet} from "@/config/chain";
import {REOWN_PROJECT_ID} from "@/lib/env";

/**
 * External wallets, kept separate from the Privy embedded wallet that every
 * account gets at login: the embedded wallet is the identity, an imported one
 * is somewhere the holder already keeps custody.
 *
 * Built lazily and cached, because `createConfig` sets up storage and EIP-6963
 * listeners that only make sense in the browser.
 */
let cached: Config | null = null;

export function getWagmiConfig(): Config {
  if (cached) return cached;

  // Typed up front: each connector factory returns a differently-shaped
  // generic, so an inferred array type rejects the third one.
  const connectors: CreateConnectorFn[] = [
    injected({shimDisconnect: true}),
    coinbaseWallet({appName: APP_NAME, preference: {options: "all"}}),
  ];

  // Browser only. WalletConnect's `setup()` reaches straight for indexedDB,
  // which does not exist on the server. Nothing is lost: the connect sheet
  // renders through a portal mounted in an effect.
  if (REOWN_PROJECT_ID && typeof window !== "undefined") {
    connectors.push(
      walletConnect({
        projectId: REOWN_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: APP_NAME,
          description: APP_TAGLINE,
          url: typeof window === "undefined" ? "" : window.location.origin,
          icons: [],
        },
      }),
    );
  }

  cached = createConfig({
    chains: [robinhoodMainnet],
    connectors,
    transports: {[robinhoodMainnet.id]: http()},
    ssr: true,
  });

  return cached;
}
