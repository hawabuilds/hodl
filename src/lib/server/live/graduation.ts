import {parseAbi, type Abi} from "viem";
import {multicallChunked} from "./chain";
import {cached, forget} from "./cache";

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
 * A minute.
 *
 * Unlike a factory address this genuinely changes — it is the moment a token
 * becomes tradeable, and a feed sorted by newest is exactly where someone
 * would notice the delay.
 */
const TTL_MS = 60_000;

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

  const key = `grad:${wanted.length}:${wanted[0]}:${wanted[wanted.length - 1]}`;

  return cached(key, TTL_MS, async () => {
    const graduated = new Set<string>();

    const [launches, pools] = await Promise.all([
      multicallChunked<{phase: number; exists: boolean}>(
        wanted.map((address) => ({
          address: PONS_V2_FACTORY,
          abi: factoryAbi as Abi,
          functionName: "getLaunchedToken",
          args: [address as `0x${string}`],
        })),
        "graduation/pons",
      ),
      multicallChunked<string>(
        wanted.map((address) => ({
          address: address as `0x${string}`,
          abi: poolAbi as Abi,
          functionName: "pool",
        })),
        "graduation/long",
      ),
    ]);

    launches.forEach((entry, i) => {
      if (entry.status !== "success" || !entry.result?.exists) return;
      if (Number(entry.result.phase) >= POOL_CREATED) graduated.add(wanted[i]);
    });

    pools.forEach((entry, i) => {
      if (entry.status !== "success") return;
      const pool = String(entry.result).toLowerCase();
      if (pool === NOT_YET || pool === ZERO) return;
      graduated.add(wanted[i]);
    });

    if (
      launches.some((entry) => entry.unreachable) ||
      pools.some((entry) => entry.unreachable)
    ) {
      forget(key);
    }

    return graduated;
  });
}
