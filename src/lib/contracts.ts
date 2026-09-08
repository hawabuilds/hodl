/**
 * Launchpad factories this app indexes.
 *
 * Every address here was confirmed on-chain: bytecode present, and either a
 * live token named it or a recent log came from it. Deploy blocks are the first
 * block we could prove activity — the public RPC rejects historical
 * `eth_getCode`, so a binary search for "code appears" is not available.
 *
 * Do not add a factory from a blog post alone. Trace a token or a log first.
 */

export const RH_MAINNET_ID = 4663;

export type LaunchpadId = "pons" | "long";

export interface FactorySpec {
  id: string;
  launchpad: LaunchpadId;
  address: `0x${string}`;
  /**
   * First block we will scan from. Prefer the first observed event; never
   * zero on a 50M-block chain.
   */
  deployedAtBlock: bigint;
  /** Token or event that proved this factory belongs to the launchpad. */
  tracedFrom: string;
}

const PONS_V2 = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as const;
const PONS_V1 = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb" as const;
const PONS_LEGACY = "0x0c37a24f5d23a486fa692d1500881d698b1f77a4" as const;
const PONS_V3 = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
const LONG_AIRLOCK = "0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862" as const;
const LONG_FACTORY = "0x22e99278308b393ea1260859b181ad7e78f5eeed" as const;

/**
 * Pons V2 — every Pons token in the 2026-09-04 feed named this via
 * `launchFactory()`. First `TokenLaunched` on the public RPC: block
 * 27027321, tx `0x38919369…`. Newest feed token: Brainrot
 * `0xea265ed8233032c3ffdf1d906cc3513e9d6a948d` (2026-09-04).
 */
export const PONS_V2_FACTORY: FactorySpec = {
  id: "pons-v2",
  launchpad: "pons",
  address: PONS_V2,
  deployedAtBlock: 27_027_321n,
  tracedFrom: "tx 0x389193691a40fc306c3114b1d96070b43a189b7b3f1a056cbf16fb517484913b",
};

/**
 * Pons V1 `PonsLaunchFactory`, published at github.com/ponsdotdev/ponsfamily.
 * Bytecode is live. The only logs found through 48M are an ERC-1967
 * `Upgraded` / `OwnershipTransferred` at block 47234326 — no TokenLaunched.
 * Still scanned from that block so a later launch cannot hide.
 */
export const PONS_V1_FACTORY: FactorySpec = {
  id: "pons-v1",
  launchpad: "pons",
  address: PONS_V1,
  deployedAtBlock: 47_234_326n,
  tracedFrom: "upgrade tx 0xb34cd929147b4545a52a89a86b107d60b755b394f12e16d97ecd180616118d28",
};

/**
 * Older Pons factory already in this repo (`launchpads.ts`). Same as V1:
 * one `Upgraded` at block 47227124, no TokenLaunched through 48M. Scanned
 * from that block.
 */
export const PONS_LEGACY_FACTORY: FactorySpec = {
  id: "pons-legacy",
  launchpad: "pons",
  address: PONS_LEGACY,
  deployedAtBlock: 47_227_124n,
  tracedFrom: "upgrade tx 0x92afeed1644eea94663bb28cdcad2a10b1107f04282033566bf07c238c613c77",
};

/**
 * Address Mobula lists as Pons V3. It is a Uniswap V3 factory
 * (`PoolCreated` topic `0x783cca1c…`), not a Pons launcher. Tokens in those
 * pools name other factories (`0x07444e4d…`, `0xf4fc0cd2…`) or none.
 * We still listen for `TokenLaunched` so a real Pons event cannot be missed;
 * we do not upsert from `PoolCreated`.
 */
export const PONS_V3_FACTORY: FactorySpec = {
  id: "pons-v3",
  launchpad: "pons",
  address: PONS_V3,
  deployedAtBlock: 46_003_341n,
  tracedFrom: "PoolCreated tx 0xc3eb7612f85fe6923032258c7328dec75491e2d81af272b05f84675b361f66c8",
};

/**
 * Doppler Airlock that Long tokens answer as `owner()`. First `Create` on
 * the public RPC: block 734616, token `test`
 * `0xa61b14c20b3fbd26a16507459ba48658a64bf7be`. Newest feed token:
 * LADYBONER `0xbe58054707de04f849b16db6020ddb5ec0521e18` (2026-09-04).
 */
export const LONG_AIRLOCK_FACTORY: FactorySpec = {
  id: "long-airlock",
  launchpad: "long",
  address: LONG_AIRLOCK,
  deployedAtBlock: 734_616n,
  tracedFrom: "0xa61b14c20b3fbd26a16507459ba48658a64bf7be",
};

/**
 * Long.xyz frontend factory (Mobula). First log at block 8636038 is
 * `OwnershipTransferred`, not a launch. Launch tokens are attributed via
 * Airlock `Create` / `owner()`. Cursor-only so a later generation can be
 * added without rescanning from zero.
 */
export const LONG_LAUNCHER_FACTORY: FactorySpec = {
  id: "long-factory",
  launchpad: "long",
  address: LONG_FACTORY,
  deployedAtBlock: 8_636_038n,
  tracedFrom: "tx 0x717af93c071b39247b5cec72930b990b917439143f6621d08797090732947cf9",
};

export const PONS_FACTORIES: FactorySpec[] = [
  PONS_V2_FACTORY,
  PONS_V1_FACTORY,
  PONS_LEGACY_FACTORY,
  PONS_V3_FACTORY,
];

export const LONG_FACTORIES: FactorySpec[] = [
  LONG_AIRLOCK_FACTORY,
  LONG_LAUNCHER_FACTORY,
];

export const ALL_FACTORIES: FactorySpec[] = [
  ...PONS_FACTORIES,
  ...LONG_FACTORIES,
];

export const PONS_FACTORY_ADDRESSES = new Set(
  PONS_FACTORIES.map((factory) => factory.address),
);

/**
 * Global Dollar (USDG) on Robinhood Chain 4663.
 * Confirmed by reading token1() on live Uniswap V3 pools, then symbol(),
 * name(), and decimals() on the token itself. Decimals are 6, not 18.
 *
 * Pools: WETH/USDG 0.01% `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`
 * (tx `0xa883817b433bfdfa683d54d2c9b857362aab795807bc752f6eca6a6e895613da`),
 * STACK/USDG 1% `0xf754dacdd007ccf3ca9ea27f5da18c9297358aae`,
 * BOW/USDG 0.3% `0x8ba9fe8a3db2acc53e32eb5651134c3e9333b8d6`.
 */
export const QUOTE_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;

/**
 * Wrapped Ether on Robinhood Chain 4663.
 * Confirmed as token0() of STACK/WETH 1%
 * `0x6d29159e52a1e41982cb058b1b14a7341a83360b` (tx
 * `0xde61fbeb5f0c508fec070cde4175b2ec3a0e85e888029fdebcf1baf6d5db00c7`)
 * and of WETH/USDG 0.01% `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`.
 * symbol() "WETH", name() "WETH", decimals() 18.
 * SwapRouter02.WETH9() returns this same address.
 */
export const QUOTE_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;

/** Native ETH sentinel — not a contract. Used when quote_token is address(0). */
export const QUOTE_ETH = "0x0000000000000000000000000000000000000000" as const;

/**
 * Uniswap V3 factory on chain 4663.
 * Confirmed: bytecode present; feeAmountTickSpacing(100/500/3000/10000)
 * returns 1/10/60/200; getPool(WETH,USDG,100) returns a pool that answers
 * slot0(), fee(), liquidity() and whose factory() is this address.
 * HODL pools (STACK/WETH, AI/WETH, BOW/USDG) return the same factory().
 */
export const UNISWAP_V3_FACTORY =
  "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

/**
 * Uniswap SwapRouter02 on chain 4663.
 * Confirmed from STACK/WETH swap tx
 * `0xde61fbeb5f0c508fec070cde4175b2ec3a0e85e888029fdebcf1baf6d5db00c7`:
 * tx.to is this address, selector `0x04e45aaf` (exactInputSingle).
 * factory() returns UNISWAP_V3_FACTORY. WETH9() returns QUOTE_WETH.
 * Not Universal Router; not V2 Router02.
 */
export const UNISWAP_SWAP_ROUTER_02 =
  "0xcaf681a66d020601342297493863e78c959e5cb2" as const;

/**
 * Canonical Permit2 on chain 4663 (and also present on 46630).
 * eth_getCode is non-empty (9152 bytes). allowance(dummy,dummy,dummy)
 * returns (0, 0, 0) — the getter exists and does not revert.
 */
export const PERMIT2 =
  "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;

/**
 * Canonical Multicall3 on chain 4663.
 * eth_getCode is 3808 bytes. getEthBalance(address(0)) returns a uint256
 * rather than reverting — the getter exists. Same address as
 * robinhoodMainnet.contracts.multicall3 and the stand-in caller in taxes.ts.
 */
export const MULTICALL3 =
  "0xca11bde05977b3631167028862be2a173976ca11" as const;

/**
 * Uniswap QuoterV2 on chain 4663.
 * Confirmed: bytecode 8273 bytes; factory() returns UNISWAP_V3_FACTORY;
 * WETH9() returns QUOTE_WETH; quoteExactInputSingle via eth_call
 * (WETH → USDG, 0.01 WETH, fee 100) returned amountOut 25079653
 * (USDG 6 decimals ≈ $25.08), plus sqrtPriceX96After / ticks / gasEstimate.
 * Ethereum's canonical QuoterV2 0x61fFE014… is a 2109-byte stub here and
 * does not quote.
 */
export const UNISWAP_QUOTER_V2 =
  "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" as const;

/** Enabled Uniswap V3 fee tiers on this factory (feeAmountTickSpacing ≠ 0). */
export const UNISWAP_V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * Uniswap V4 PoolManager singleton on chain 4663.
 * Confirmed: bytecode present; Pons hook
 * `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`.poolManager() returns this.
 * V4 Swap logs used by the trade tape emit from this address.
 */
export const UNISWAP_V4_POOL_MANAGER =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;

/**
 * Uniswap V4 Quoter on chain 4663 (docs + bytecode). Used when a token has
 * no V3 pool and must be quoted through PoolManager + hook.
 */
export const UNISWAP_V4_QUOTER =
  "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as const;

/**
 * Uniswap V4 StateView on chain 4663.
 * getSlot0 / getLiquidity take the PoolId (keccak of PoolKey).
 */
export const UNISWAP_V4_STATE_VIEW =
  "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;

/**
 * Deep WETH/USDG 0.01% V3 pool. WETH is token0, USDG token1.
 * ETH/USD = slot0 raw price × 1e12 (18 − 6 decimals).
 */
export const WETH_USDG_V3_POOL =
  "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca" as const;

/**
 * Universal Router 2.1.1 on chain 4663. Uniswap's own constants file and
 * Trading API both name this address; 2.0 is not deployed here and a 2.0
 * payload is rejected.
 */
export const UNIVERSAL_ROUTER =
  "0x8876789976decbfcbbbe364623c63652db8c0904" as const;

/**
 * Hodl FeeCollector on 4663. Holds the 50 bps platform skim so UR
 * stock-paired trades pay the same fee as HodlRouter single hops.
 */
export const FEE_COLLECTOR =
  "0x1090d265749c1199919a754a8c2dd00150d1f0f9" as const;

/**
 * Pons Uniswap V4 hook. launches(poolId) is the fee record; poolManager()
 * returns UNISWAP_V4_POOL_MANAGER.
 */
export const PONS_V4_HOOK =
  "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as const;

/** Locked Pons V4 PoolKey fields. Recovered from the launchpad factory. */
export const PONS_V4_FEE = 0;
export const PONS_V4_TICK_SPACING = 200;

/**
 * Doppler initializer — this address *is* the Long V4 hook.
 * Airlock getAssetData().poolInitializer.
 */
export const LONG_DOPPLER_HOOK =
  "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544" as const;
export const LONG_V4_FEE = 0x800000;
export const LONG_V4_TICK_SPACING = 8;

export const LONG_IMPLEMENTATION =
  "0x3be8b97fd0e713b5abe0649fa830223b6b4bc599" as const;
