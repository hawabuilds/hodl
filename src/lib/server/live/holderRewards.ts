import {parseAbi, type Abi} from "viem";
import {multicallChunked} from "./chain";
import {cached, forget} from "./cache";

/**
 * Tokens whose trading fees are paid back to the people holding them.
 *
 * Pons does not do this itself — its own contracts split a trade fee between
 * the protocol, the creator and an optional buyback, with no holder share
 * anywhere. The routing happens one step further out: a launch records a
 * `creatorFeeRecipient`, and a creator who wants their cut to reach holders
 * sets that recipient to a distributor contract instead of their own wallet.
 *
 * So the question "does this token reward its holders" is answered by what
 * that recipient *is*, not by anything in the launchpad. A distributor built
 * for one token reports which token it belongs to, and a recipient that names
 * this token is a distributor for it. A wallet answers nothing.
 *
 * This is not a rare arrangement — twelve of the twenty-four Pons tokens in a
 * live sample route fees this way, the $1 coin among them.
 */

const factoryAbi = parseAbi([
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);

/**
 * The distributor's own accessor.
 *
 * Reverting is the common answer — a plain wallet has no code and most
 * contracts do not implement it — and reverting is exactly the negative
 * result, so failures are read rather than thrown.
 */
const distributorAbi = parseAbi(["function token() view returns (address)"]);

const PONS_V2_FACTORY =
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as `0x${string}`;

/**
 * Half an hour.
 *
 * A launch's fee recipient is set at creation and changes rarely, but it *can*
 * change — the factory exposes a setter — so this is not cached for the life of
 * the process the way an immutable factory address is.
 */
const TTL_MS = 30 * 60_000;

interface LaunchRecord {
  creatorFeeRecipient: `0x${string}`;
  exists: boolean;
}

/**
 * Which of these tokens pay their holders.
 *
 * Two multicalls for any number of tokens: one to read every launch's fee
 * recipient, one to ask each recipient which token it serves. Deliberately no
 * `eth_getCode` — a wallet simply fails the second call, which is the same
 * answer for a third of the round trips.
 */
export async function holderRewardsFor(
  addresses: string[],
): Promise<Set<string>> {
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return new Set();

  // Keyed on the shape of the set rather than every address in it: the join
  // was a kilobyte-long key rebuilt on every call.
  const key = `rewards:${wanted.length}:${wanted[0]}:${wanted[wanted.length - 1]}`;

  return cached(key, TTL_MS, async () => {
    const paying = new Set<string>();

    const launches = await multicallChunked<LaunchRecord>(
      wanted.map((address) => ({
        address: PONS_V2_FACTORY,
        abi: factoryAbi as Abi,
        functionName: "getLaunchedToken",
        args: [address as `0x${string}`],
      })),
      "holderRewards/launches",
    );

    const recipients: {token: string; recipient: `0x${string}`}[] = [];

    let unreachable = launches.some((entry) => entry.unreachable);

    launches.forEach((entry, i) => {
      if (entry.status !== "success" || !entry.result?.exists) return;
      const recipient = entry.result.creatorFeeRecipient;
      if (!recipient || /^0x0+$/.test(recipient)) return;
      recipients.push({token: wanted[i], recipient});
    });

    if (recipients.length === 0) {
      if (unreachable) forget(key);
      return paying;
    }

    const bound = await multicallChunked<string>(
      recipients.map((entry) => ({
        address: entry.recipient,
        abi: distributorAbi as Abi,
        functionName: "token",
      })),
      "holderRewards/bound",
    );

    unreachable ||= bound.some((entry) => entry.unreachable);

    bound.forEach((entry, i) => {
      if (entry.status !== "success") return;
      // The recipient has to name *this* token. A contract that names another
      // is somebody else's distributor that happens to collect the fee.
      if (String(entry.result).toLowerCase() === recipients[i].token) {
        paying.add(recipients[i].token);
      }
    });

    // An answer assembled from calls that never ran is not an answer. Dropping
    // it means the next request tries again instead of everyone reading an
    // empty set for the next half hour.
    if (unreachable) forget(key);
    return paying;
  });
}
