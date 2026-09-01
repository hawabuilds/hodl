import { defineChain } from "viem";

export const RH_TESTNET_ID = 46630;
export const RH_MAINNET_ID = 4663;

const DEFAULT_RPC = "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

const DEFAULT_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";

/**
 * Mainnet, read-only. The contracts live on testnet, but the Chainlink stock
 * feeds and the Stock Tokens themselves only exist here, so the resolution job
 * reads prices from mainnet while claims keep settling in testnet mocks.
 *
 * ALCHEMY_RPC_URL is preferred: Alchemy is the RPC provider Robinhood Chain
 * recommends, and the public endpoint is not rate-limit friendly for a job that
 * reads a couple of hundred balances at once.
 */
export const robinhoodMainnet = defineChain({
  id: RH_MAINNET_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.ALCHEMY_RPC_URL || DEFAULT_MAINNET_RPC],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const robinhoodTestnet = defineChain({
  id: RH_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RH_TESTNET_RPC || DEFAULT_RPC],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: EXPLORER,
      apiUrl: `${EXPLORER}/api`,
    },
  },
  testnet: true,
});

export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";

export function explorerTxUrl(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerAddressUrl(address: string) {
  return `${EXPLORER}/address/${address}`;
}

const MAINNET_EXPLORER = "https://robinhoodchain.blockscout.com";

/** Holdings span both chains, so the link has to follow the token. */
export function addressUrlForChain(address: string, chainId: number) {
  const base = chainId === RH_MAINNET_ID ? MAINNET_EXPLORER : EXPLORER;
  return `${base}/address/${address}`;
}
