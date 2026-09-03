import {parseAbi, type Abi} from "viem";
import type {DexPair} from "./dexscreener";
import {multicallChunked} from "./chain";
import {readManyShared, writeManyShared} from "./shared";

/**
 * Which launchpad tokens have finished bonding.
 *
 * Both launchpads start a token on a bonding curve and move it into a real
 * pool once it fills. Until that happens there is no market — the curve prices
 * every trade off a formula — and the feed was listing those alongside traded
 * tokens because a curve is indexed as a pool like anything else.
 *
 * The tell is visible in the numbers if you know to look: fourteen of the
 * twenty newest entries carried within a few hundred dollars of the same
 * "liquidity", because that figure was the curve's seeded reserve rather than
 * anyone's money. One of them read half a billion. So this asks the contracts
 * instead.
 *
 * The two launchpads answer differently:
 *
 * - Pons records a phase per launch on its factory, and `PoolCreated` is the
 *   one that means graduated. Each token points at its own factory via
 *   `launchFactory()` — querying only the V2 factory missed V1 and V3 launches.
 * - Long writes the pool onto the token, leaving a dead address until then.
 */

const factoryAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);

const launchFactoryAbi = parseAbi([
  "function launchFactory() view returns (address)",
]);

const poolAbi = parseAbi(["function pool() view returns (address)"]);

/** Pons factories this app recognises — must stay in sync with launchpads.ts. */
const PONS_FACTORIES = new Set([
  "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb",
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
  "0x0c37a24f5d23a486fa692d1500881d698b1f77a4",
]);

const PONS_V2_FACTORY =
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as `0x${string}`;

/** `GraduationPhase.PoolCreated`. Anything below it is still on the curve. */
const POOL_CREATED = 2;

/** What Long's token holds while it is still bonding. */
const NOT_YET = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";

/**
 * Tokens a single request will resolve when the cache does not know them.
 *
 * Launchpad tokens are resolved first so the New tab is right even when the
 * full set does not fit in one pass.
 */
const RESOLVE_PER_REQUEST = 400;

const ZERO = "0x0000000000000000000000000000000000000000";

/** Real turnover on an RWA pair — curves barely trade while bonding. */
const MARKET_VOLUME_USD = 5_000;

/**
 * When chain reads fail or point at the wrong factory, a launchpad token with
 * real volume on its stock pair has clearly graduated.
 */
export function marketProvesGraduated(
  pair: DexPair,
  rwaPaired: boolean,
): boolean {
  if (!rwaPaired) return false;
  const liq = pair.liquidity?.usd ?? 0;
  const vol = pair.volume?.h24 ?? 0;
  if (liq < 1_000) return false;
  return vol >= MARKET_VOLUME_USD;
}

/**
 * The tokens here that have graduated into a real pool.
 *
 * Pons is checked on the factory the token actually names. Long is checked
 * through `pool()`. Launchpad addresses are resolved before the rest so the
 * New tab does not depend on every token in the feed being read first.
 */
export async function graduatedFrom(
  addresses: string[],
  priority: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return new Set();

  const graduated = new Set<string>();

  const known = await readManyShared<boolean>(wanted.map((a) => `grad:${a}`));
  const unknown: string[] = [];

  for (const address of wanted) {
    const hit = known.get(`grad:${address}`);
    if (hit === undefined) unknown.push(address);
    else if (hit) graduated.add(address);
  }

  if (unknown.length === 0) return graduated;

  unknown.sort(
    (a, b) =>
      (priority.has(a) ? 0 : 1) - (priority.has(b) ? 0 : 1) ||
      a.localeCompare(b),
  );

  const batch = unknown.slice(0, RESOLVE_PER_REQUEST);

  const launchFactories = await multicallChunked<string>(
    batch.map((address) => ({
      address: address as `0x${string}`,
      abi: launchFactoryAbi as Abi,
      functionName: "launchFactory",
    })),
    "graduation/factory",
  );

  const [launches, pools] = await Promise.all([
    multicallChunked<{phase: number; exists: boolean}>(
      batch.map((address, i) => {
        const named =
          launchFactories[i]?.status === "success"
            ? String(launchFactories[i].result).toLowerCase()
            : "";
        const target = PONS_FACTORIES.has(named)
          ? (named as `0x${string}`)
          : PONS_V2_FACTORY;
        return {
          address: target,
          abi: factoryAbi as Abi,
          functionName: "getLaunchedToken",
          args: [address as `0x${string}`],
        };
      }),
      "graduation/pons",
    ),
    multicallChunked<string>(
      batch.map((address) => ({
        address: address as `0x${string}`,
        abi: poolAbi as Abi,
        functionName: "pool",
      })),
      "graduation/long",
    ),
  ]);

  const answered = new Map<string, boolean>();

  batch.forEach((address, i) => {
    const launch = launches[i];
    const pool = pools[i];

    let isGraduated = false;

    if (launch?.status === "success" && launch.result?.exists) {
      isGraduated = Number(launch.result.phase) >= POOL_CREATED;
    }

    if (!isGraduated && pool?.status === "success") {
      const value = String(pool.result).toLowerCase();
      isGraduated = value !== NOT_YET && value !== ZERO;
    }

    if (isGraduated) {
      graduated.add(address);
      answered.set(address, true);
      return;
    }

    if (launch?.unreachable || pool?.unreachable) return;

    answered.set(address, false);
  });

  void writeManyShared(
    [...answered].map(([address, value]) => ({
      key: `grad:${address}`,
      value,
      ttlSeconds: value ? 24 * 60 * 60 : 5 * 60,
    })),
  );

  return graduated;
}
