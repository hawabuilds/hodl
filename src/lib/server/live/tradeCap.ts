import {formatEther} from "viem";
import {HODL_ROUTER, QUOTE_USDG} from "@/lib/contracts";
import {hodlRouterAbi} from "@/lib/hodlRouter";
import {humanToRaw} from "@/lib/quoteAmounts";
import {isEthish} from "@/lib/swapRoute";
import {usdgRawOverCap} from "@/lib/tradePolicy";
import {rpc} from "./chain";
import {ethUsd} from "./onchainPrice";

type ReadClient = Pick<ReturnType<typeof rpc>, "readContract">;

/**
 * A trade's size in raw USDG units, priced the way HodlRouter prices it:
 * USDG as is, ETH and WETH through the router's own `quoteUsdg` (10-minute
 * TWAP of the WETH/USDG pool). Spot price only if the router can't answer.
 * Null for any other token.
 */
export async function tradeUsdgRaw(
  token: string,
  amount: bigint,
  client: ReadClient = rpc(),
  spotEthUsd: () => Promise<number | null> = ethUsd,
): Promise<bigint | null> {
  if (token.toLowerCase() === QUOTE_USDG) return amount;
  if (!isEthish(token)) return null;
  try {
    return await client.readContract({
      address: HODL_ROUTER,
      abi: hodlRouterAbi,
      functionName: "quoteUsdg",
      args: [amount],
    });
  } catch {
    const eth = await spotEthUsd();
    return eth && eth > 0 ? humanToRaw(Number(formatEther(amount)) * eth, 6) : null;
  }
}

/**
 * Whether HodlRouter would revert this trade with `Cap()`: a buy by what it
 * pays, a sell by what it pays out before the fee. Null when the token is not
 * ETH, WETH or USDG.
 */
export async function overTradeCap(
  token: string,
  amount: bigint,
  client?: ReadClient,
  spotEthUsd?: () => Promise<number | null>,
): Promise<boolean | null> {
  const raw = await tradeUsdgRaw(token, amount, client, spotEthUsd);
  return raw == null ? null : usdgRawOverCap(raw);
}
