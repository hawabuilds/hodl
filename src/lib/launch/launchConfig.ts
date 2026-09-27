/**
 * Addresses and economics for launching a token, as opposed to reading one.
 *
 * `contracts.ts` owns the addresses this app *indexes*. This file owns the ones
 * it *calls*, and it follows the same rule: every value below was recovered by
 * decoding a real launch transaction, never from a blog post or a guess. The
 * transaction each one came from is named so the next person can re-derive it.
 *
 * Both launch calls were confirmed by decoding the transaction, re-encoding it
 * from plain values and comparing bytes. `test/launch-encoding.test.ts` keeps
 * that true — it is the test that matters, because a struct field in the wrong
 * order produces calldata that encodes perfectly and launches something else.
 */

import {
  LONG_AIRLOCK_FACTORY,
  LONG_DOPPLER_HOOK,
  PONS_V2_FACTORY,
  QUOTE_WETH,
  UNISWAP_V4_POOL_MANAGER,
  UNIVERSAL_ROUTER,
} from "@/lib/contracts";

/** The launchpads a token can be created on from here. */
export type LaunchpadTarget = "pons" | "long";

/* ────────────────────────────── Pons ────────────────────────────── */

/**
 * The V2 bonding-curve factory. Same address the indexer watches for
 * `TokenLaunched`; here it is the contract we call.
 *
 * Traced from tx 0xd327a9a66a6bce5955cb9b3dda1b98f3905e08491e6c1420f244d2fc1067d8a5,
 * a direct EOA call carrying selector 0xa72101af.
 */
export const PONS_LAUNCH_FACTORY = PONS_V2_FACTORY.address;

/**
 * Pons runs a periphery contract its own site launches through
 * (0xe33e9e47…, selector 0xf85f8e41). We deliberately do not use it: the
 * factory accepts a direct call, and a direct call is one fewer contract
 * whose behaviour we would be trusting without its source.
 */

/* ────────────────────────────── Long ────────────────────────────── */

/**
 * Doppler modules, every one read out of the same known-good launch:
 * tx 0xed3854d23f28b5eff758d1ff998ee9b57385b1635ce3c9b1c51159afeb2013b8,
 * a direct `create(CreateParams)` on the Airlock (selector 0x882db707).
 *
 * The Airlock allowlists modules, so a wrong address here reverts rather than
 * launching something unexpected — but `getModuleState` is still worth reading
 * before a launch, because a revert after the user has signed is a worse
 * experience than a disabled button.
 */
export const LONG_MODULES = {
  airlock: LONG_AIRLOCK_FACTORY.address,
  tokenFactory: "0x1b37d3a72082029c44b35b604ea473617580b69a",
  governanceFactory: "0xdb036746d65dd52126b1915f1adf555e6c5237cf",
  /** The Doppler initializer is also the V4 hook; `contracts.ts` already names it. */
  poolInitializer: LONG_DOPPLER_HOOK,
  liquidityMigrator: "0xba2f330edb16cd8056f5988d8ce19bbc63475a0e",
} as const;

/**
 * Long's own integrator address, which receives the integrator share.
 *
 * Kept as their value rather than swapped for ours. Pointing it at hodl would
 * change the economics of a launch the user believes is a Long launch, and
 * that is not a decision to make silently inside an encoder.
 */
export const LONG_INTEGRATOR = "0xf60633d02690e2a15a54ab919925f3d038df163e";

/**
 * Supply split. 100bn minted, 85bn sold through the curve.
 * Read from the reference launch; not a free parameter.
 */
export const LONG_INITIAL_SUPPLY = 100_000_000_000n * 10n ** 18n;
export const LONG_NUM_TOKENS_TO_SELL = 85_000_000_000n * 10n ** 18n;

/** Only WETH was observed as a numeraire on Long launches. */
export const LONG_NUMERAIRE = QUOTE_WETH;

/**
 * Vesting: a 30-day cliff over a 365-day schedule.
 *
 * Encoded as a `(cliff, duration)[]`, which is why it is a list of one rather
 * than two numbers.
 */
export const LONG_VESTING: readonly (readonly [bigint, bigint])[] = [
  [2_592_000n, 31_536_000n],
];

/** 15bn of the 100bn supply vests to the creator. */
export const LONG_VESTING_AMOUNT = 15_000_000_000n * 10n ** 18n;

/** Inflation cap the token template enforces after launch. */
export const LONG_YEARLY_MINT_RATE = 2_000_000_000n * 10n ** 18n;

/**
 * Contracts the token template authorises to move balances before transfers
 * open. Order is preserved from the reference launch — the template may treat
 * this as a list rather than a set, and re-sorting it is not worth the risk.
 */
export const LONG_AUTHORIZED: readonly string[] = [
  "0x6f02324d20cc679d0e585290caa6b16bacbc0f77",
  "0x9982538f41f2ae29ddb9d3d9307010052984fdbb",
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f",
  "0x1d4b86491ec211257cbedd77a4380a7494624eff",
  "0x8f10b468b06c6fd214b65f87778827f7d113f996",
  UNIVERSAL_ROUTER,
  LONG_DOPPLER_HOOK,
  LONG_MODULES.liquidityMigrator,
  UNISWAP_V4_POOL_MANAGER,
];

/**
 * The bonding curve: three tick bands carrying 3%, 95% and 2% of the sold
 * supply. Ticks are negative because the memecoin is the expensive side of
 * the pair at launch.
 */
export const LONG_CURVE: readonly (readonly [number, number, number, bigint])[] = [
  [-240_000, -233_200, 1, 30_000_000_000_000_000n],
  [-233_200, -123_200, 1, 950_000_000_000_000_000n],
  [-123_200, 887_200, 1, 20_000_000_000_000_000n],
];

/** Fee share of the pool, in wad: 5% to Long, 95% to the creator. */
export const LONG_BENEFICIARY_PROTOCOL = "0x21e2ce70511e4fe542a97708e89520471daa7a66";
export const LONG_PROTOCOL_SHARE = 50_000_000_000_000_000n;
export const LONG_CREATOR_SHARE = 950_000_000_000_000_000n;

/** Pool shape at initialisation. Not `LONG_V4_FEE` — that is the live pool's. */
export const LONG_INIT_FEE = 7000;
export const LONG_INIT_TICK_SPACING = 200;
export const LONG_INIT_MAX_TICK = 887_000;

/** Passed to the initializer alongside the curve; also in the authorised list. */
export const LONG_INIT_OWNER = "0x9982538f41f2ae29ddb9d3d9307010052984fdbb";

/**
 * The initializer's migrator configuration, verbatim from the reference launch.
 *
 * It holds WETH, the `0xdead…dead` sentinel `graduation.ts` knows as `NOT_YET`,
 * some ratios, and two migration beneficiaries splitting fees 1/3 and 2/3.
 *
 * Those two addresses were the reason to check rather than assume: a blob
 * carrying beneficiaries could easily have been carrying the *reference
 * launch's creator*, and passing it through would have routed every hodl
 * launch's migration fees to a stranger. Decoding three unrelated launches
 * settled it — both addresses and both shares are identical in all of them, so
 * they are Long's own and this blob is a constant.
 *
 * Kept opaque deliberately. Nothing here needs to read it, and re-encoding a
 * structure we only partly understand is how a launch ends up subtly different
 * from the one that was verified.
 */
export const LONG_MIGRATOR_CONFIG =
  "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000bd7d308f8e1639fab988df18a8011f41eacad73000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000c35000000000000000000000000000000000000000000000000000000000000002904000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009e9a7129c22db6e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003f70fa10b4124920000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009e9a7129c22db6e00000000000000000000000000000000000000000000000003f70fa10b41249200000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000042455f9990098e11592be1fbd72e6dc68419b1300000000000000000000000000000000000000000000000004a03ce68d2155550000000000000000000000005f8da8f88ec81e27f2e22fcb9ca5d926c595e508000000000000000000000000000000000000000000000000094079cd1a42aaab" as const;
