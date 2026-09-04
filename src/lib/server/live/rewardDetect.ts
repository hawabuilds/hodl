import {parseAbi} from "viem";
import {normalizeAddress} from "@/lib/address";
import {RWA_BY_ADDRESS} from "./robinhood";
import {rpc} from "./chain";
import {db, hasDatabase} from "../db";

const distributorAbi = parseAbi(["function token() view returns (address)"]);
const rewardGetters = parseAbi([
  "function rewardToken() view returns (address)",
  "function rewardAsset() view returns (address)",
  "function dividendToken() view returns (address)",
  "function reflectionToken() view returns (address)",
]);

/**
 * Whether this token routes holder rewards in an RWA stock.
 *
 * State lives on the token (or a Pons fee recipient), not in a factory event.
 * Long's Doppler hook streams pair-token fees to named wallets — that is not
 * an RWA holder reward and is not read here.
 */
export async function rewardRwaFor(
  token: string,
  recipient: string | null,
): Promise<{ticker: string; kind: string} | null> {
  const probes: {address: `0x${string}`; fn: "rewardToken" | "rewardAsset" | "dividendToken" | "reflectionToken"}[] =
    [];
  for (const fn of ["rewardToken", "rewardAsset", "dividendToken", "reflectionToken"] as const) {
    probes.push({address: token as `0x${string}`, fn});
    if (recipient && recipient !== "0x0000000000000000000000000000000000000000") {
      probes.push({address: recipient as `0x${string}`, fn});
    }
  }

  for (const probe of probes) {
    try {
      const result = await rpc().readContract({
        address: probe.address,
        abi: rewardGetters,
        functionName: probe.fn,
      });
      const rwa = RWA_BY_ADDRESS.get(normalizeAddress(String(result)));
      if (rwa) return {ticker: rwa.ticker, kind: probe.fn};
    } catch {
      // getter missing
    }
  }

  if (recipient && recipient !== "0x0000000000000000000000000000000000000000") {
    try {
      const bound = await rpc().readContract({
        address: recipient as `0x${string}`,
        abi: distributorAbi,
        functionName: "token",
      });
      if (normalizeAddress(String(bound)) !== normalizeAddress(token)) {
        // not this token's distributor
      } else if (hasDatabase) {
        const {data} = await db()
          .from("reward_distributions")
          .select("rwa_ticker")
          .eq("distributor", normalizeAddress(recipient))
          .limit(1);
        const ticker = data?.[0]?.rwa_ticker;
        if (ticker) return {ticker: String(ticker), kind: "distributor"};
      }
    } catch {
      // wallet
    }
  }

  if (hasDatabase) {
    const {data} = await db()
      .from("reward_distributions")
      .select("rwa_ticker")
      .eq("token_address", normalizeAddress(token))
      .limit(1);
    const ticker = data?.[0]?.rwa_ticker;
    if (ticker) return {ticker: String(ticker), kind: "distribution"};
  }

  return null;
}
