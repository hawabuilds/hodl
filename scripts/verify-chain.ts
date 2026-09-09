/**
 * Bytecode check for the confirmed 4663 addresses in lib/contracts.ts.
 * Does not print env values.
 *
 *   npm run verify:chain
 */
import {createPublicClient, http} from "viem";
import {robinhoodMainnet} from "../src/config/chain";
import {createReadTransport} from "../src/lib/server/live/rpcProviders";
import {
  LONG_AIRLOCK_FACTORY,
  LONG_DOPPLER_HOOK,
  MULTICALL3,
  PERMIT2,
  PONS_V2_FACTORY,
  PONS_V4_HOOK,
  QUOTE_USDG,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_QUOTER_V2,
  UNISWAP_SWAP_ROUTER_02,
  UNISWAP_V3_FACTORY,
  UNISWAP_V4_POOL_MANAGER,
  UNISWAP_V4_QUOTER,
  WETH_USDG_V3_POOL,
} from "../src/lib/contracts";

const named: Record<string, `0x${string}`> = {
  UniversalRouter: UNIVERSAL_ROUTER,
  SwapRouter02: UNISWAP_SWAP_ROUTER_02,
  V3Factory: UNISWAP_V3_FACTORY,
  QuoterV2: UNISWAP_QUOTER_V2,
  V4PoolManager: UNISWAP_V4_POOL_MANAGER,
  V4Quoter: UNISWAP_V4_QUOTER,
  Permit2: PERMIT2,
  Multicall3: MULTICALL3,
  WETH: QUOTE_WETH,
  USDG: QUOTE_USDG,
  WethUsdgPool: WETH_USDG_V3_POOL,
  PonsHook: PONS_V4_HOOK,
  LongHook: LONG_DOPPLER_HOOK,
  PonsFactory: PONS_V2_FACTORY.address,
  LongAirlock: LONG_AIRLOCK_FACTORY.address,
};

async function main() {
  const client = createPublicClient({
    chain: robinhoodMainnet,
    transport: createReadTransport(),
  });
  const chainId = await client.getChainId();
  if (chainId !== 4663) {
    throw new Error(`expected chain 4663, got ${chainId}`);
  }
  const missing: string[] = [];
  for (const [name, address] of Object.entries(named)) {
    const code = await client.getCode({address});
    if (!code || code === "0x") missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`no bytecode: ${missing.join(", ")}`);
  }
  console.log(`verify:chain ok — ${Object.keys(named).length} contracts on 4663`);

  const chainstack = process.env.CHAINSTACK_RPC_URL?.trim();
  if (chainstack?.startsWith("https://")) {
    const cs = createPublicClient({
      chain: robinhoodMainnet,
      transport: http(chainstack, {timeout: 12_000, retryCount: 0}),
    });
    const csId = await cs.getChainId();
    console.log(`verify:chain CHAINSTACK_RPC_URL ok — chain ${csId}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
