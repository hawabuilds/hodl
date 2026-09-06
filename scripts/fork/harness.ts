/**
 * Anvil fork of Robinhood Chain 4663.
 *
 * There is no Uniswap on testnet 46630. Every HodlRouter integration test
 * in this folder talks to this harness — never to a fresh Anvil chain.
 *
 *   anvil --fork-url $ALCHEMY_RPC_URL --chain-id 4663 --port 8545
 *
 * Then: FORK_RPC_URL=http://127.0.0.1:8545 npm test -- test/hodl-router-fork.test.ts
 *
 * This file does not print env values.
 */
import {createPublicClient, createWalletClient, http, type Hex, type PublicClient} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {robinhoodMainnet} from "../../src/config/chain";
import {
  LONG_AIRLOCK_FACTORY,
  LONG_DOPPLER_HOOK,
  LONG_V4_FEE,
  LONG_V4_TICK_SPACING,
  PONS_V2_FACTORY,
  PONS_V4_FEE,
  PONS_V4_HOOK,
  PONS_V4_TICK_SPACING,
  QUOTE_USDG,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
  WETH_USDG_V3_POOL,
} from "../../src/lib/contracts";

export const FORK_CHAIN_ID = 4663;

export const CONFIRMED = {
  universalRouter: UNIVERSAL_ROUTER,
  swapRouter02: UNISWAP_SWAP_ROUTER_02,
  weth: QUOTE_WETH,
  usdg: QUOTE_USDG,
  wethUsdgPool: WETH_USDG_V3_POOL,
  ponsFactory: PONS_V2_FACTORY.address,
  ponsHook: PONS_V4_HOOK,
  ponsFee: PONS_V4_FEE,
  ponsTick: PONS_V4_TICK_SPACING,
  airlock: LONG_AIRLOCK_FACTORY.address,
  longHook: LONG_DOPPLER_HOOK,
  longFee: LONG_V4_FEE,
  longTick: LONG_V4_TICK_SPACING,
} as const;

/** Tokens named in contracts.ts discovery comments. */
export const FORK_TOKENS = {
  /// Airlock getAssetData numeraire is WETH. Discovery "newest" tokens pair RWAs.
  longWeth: "0xa61b14c20b3fbd26a16507459ba48658a64bf7be" as const,
  v3Pool: "0x6d29159e52a1e41982cb058b1b14a7341a83360b" as const,
};

export function forkRpcUrl(): string {
  return process.env.FORK_RPC_URL || "http://127.0.0.1:8545";
}

export function forkPublicClient(): PublicClient {
  return createPublicClient({
    chain: {...robinhoodMainnet, rpcUrls: {default: {http: [forkRpcUrl()]}}},
    transport: http(forkRpcUrl()),
  }) as PublicClient;
}

/** Anvil default account 0. Only used against the local fork. */
export function forkAnvilAccount() {
  const key = (process.env.ANVIL_PRIVATE_KEY
    ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
  return privateKeyToAccount(key);
}

export function forkWalletClient() {
  const account = forkAnvilAccount();
  return createWalletClient({
    account,
    chain: {...robinhoodMainnet, rpcUrls: {default: {http: [forkRpcUrl()]}}},
    transport: http(forkRpcUrl()),
  });
}

export async function assertForked4663(client: PublicClient = forkPublicClient()): Promise<void> {
  const id = await client.getChainId();
  if (id !== FORK_CHAIN_ID) {
    throw new Error(`fork harness expected chain ${FORK_CHAIN_ID}, got ${id}`);
  }
}
