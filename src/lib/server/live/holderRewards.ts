import {parseAbi, type Abi} from "viem";
import {multicallChunked} from "./chain";
import {readManyShared, writeManyShared} from "./shared";

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

const PONS_V2_FACTORY =
  "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as `0x${string}`;

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

  const paying = new Set<string>();

  // Per token, for the same reason as graduation: keyed on the set, one token
  // moving invalidated every other answer in it.
  const known = await readManyShared<boolean>(
    wanted.map((a) => `rewards:${a}`),
  );
  const unknown: string[] = [];

  for (const address of wanted) {
    const hit = known.get(`rewards:${address}`);
    if (hit === undefined) unknown.push(address);
    else if (hit) paying.add(address);
  }

  if (unknown.length === 0) return paying;

  const batch = unknown.slice(0, RESOLVE_PER_REQUEST);

  const launches = await multicallChunked<LaunchRecord>(
    batch.map((address) => ({
      address: PONS_V2_FACTORY,
      abi: factoryAbi as Abi,
      functionName: "getLaunchedToken",
      args: [address as `0x${string}`],
    })),
    "holderRewards/launches",
  );

  const answered = new Map<string, boolean>();
  const recipients: {token: string; recipient: `0x${string}`}[] = [];

  launches.forEach((entry, i) => {
    const address = batch[i];
    // No answer is not a no.
    if (entry.unreachable) return;

    if (entry.status !== "success" || !entry.result?.exists) {
      answered.set(address, false);
      return;
    }

    const recipient = entry.result.creatorFeeRecipient;
    if (!recipient || /^0x0+$/.test(recipient)) {
      answered.set(address, false);
      return;
    }

    recipients.push({token: address, recipient});
  });

  if (recipients.length > 0) {
    const bound = await multicallChunked<string>(
      recipients.map((entry) => ({
        address: entry.recipient,
        abi: distributorAbi as Abi,
        functionName: "token",
      })),
      "holderRewards/bound",
    );

    bound.forEach((entry, i) => {
      const {token} = recipients[i];
      if (entry.unreachable) return;

      // The recipient has to name *this* token. A contract that names another
      // is somebody else's distributor that happens to collect the fee.
      const routes =
        entry.status === "success" &&
        String(entry.result).toLowerCase() === token;

      answered.set(token, routes);
      if (routes) paying.add(token);
    });
  }

  void writeManyShared(
    [...answered].map(([address, value]) => ({
      key: `rewards:${address}`,
      value,
      // A creator can repoint their fee, so this expires either way.
      ttlSeconds: 30 * 60,
    })),
  );

  return paying;
}
