import {parseAbi, type Abi} from "viem";
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
 *   one that means graduated.
 * - Long writes the pool onto the token, leaving a dead address until then.
 */

const factoryAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);

const poolAbi = parseAbi(["function pool() view returns (address)"]);

const PONS_V2_FACTORY =
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as `0x${string}`;

/** `GraduationPhase.PoolCreated`. Anything below it is still on the curve. */
const POOL_CREATED = 2;

/** What Long's token holds while it is still bonding. */
const NOT_YET = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";

/**
 * Tokens a single request will resolve when the cache does not know them.
 *
 * Reading a thousand tokens off the chain takes seconds however it is paced,
 * and no visitor should ever wait for it. A request answers from cache and
 * resolves at most this many unknowns, so the work spreads over successive
 * calls — and the warming cron, which runs every five minutes, does most of it
 * before anyone arrives. Whatever is not yet known is simply not claimed.
 */
const RESOLVE_PER_REQUEST = 240;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * The tokens here that have graduated into a real pool.
 *
 * Two multicalls whatever the size of the set. A token that answers neither
 * contract is left out: unproven is not the same as graduated, and the feed
 * this feeds is specifically the one promising traded markets.
 */
export async function graduatedFrom(
  addresses: string[],
): Promise<Set<string>> {
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return new Set();

  const graduated = new Set<string>();

  // Cached per token rather than per request. Keying on the shape of the set
  // meant a single token joining or leaving threw away the answer for all
  // thousand of them, which on a cold instance is most of the wait.
  const known = await readManyShared<boolean>(wanted.map((a) => `grad:${a}`));
  const unknown: string[] = [];

  for (const address of wanted) {
    const hit = known.get(`grad:${address}`);
    if (hit === undefined) unknown.push(address);
    else if (hit) graduated.add(address);
  }

  if (unknown.length === 0) return graduated;

  const batch = unknown.slice(0, RESOLVE_PER_REQUEST);

  const [launches, pools] = await Promise.all([
    multicallChunked<{phase: number; exists: boolean}>(
      batch.map((address) => ({
        address: PONS_V2_FACTORY,
        abi: factoryAbi as Abi,
        functionName: "getLaunchedToken",
        args: [address as `0x${string}`],
      })),
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

    // A no is only a no when both contracts actually answered. Either one
    // being unreachable leaves the question open, and caching it as "not
    // graduated" is how a batch failure turned into a day of wrong answers —
    // it took the New tab from a hundred and fifty tokens to nineteen.
    if (launch?.unreachable || pool?.unreachable) return;

    answered.set(address, false);
  });

  // Graduation happens once and never reverses, so a yes is kept for a day.
  // A no has to expire, but not quickly: at a minute the nine hundred tokens
  // still bonding were re-read every minute, which is sixteen multicall
  // batches a minute to learn nothing. Five minutes is well inside what
  // "freshly graduated" means on a feed.
  void writeManyShared(
    [...answered].map(([address, value]) => ({
      key: `grad:${address}`,
      value,
      ttlSeconds: value ? 24 * 60 * 60 : 5 * 60,
    })),
  );

  return graduated;
}
