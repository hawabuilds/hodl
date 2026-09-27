import {json} from "@/lib/server/http";
import {multicallChunked} from "@/lib/server/live/chain";
import {RWA_REGISTRY} from "@/lib/server/live/robinhood";
import {PONS_LAUNCH_FACTORY} from "@/lib/launch/launchConfig";
import {ponsFactoryAbi} from "@/lib/launch/ponsLaunch";
import {QUOTE_ETH as NATIVE_ETH, QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What a launch may be priced in, and what it costs.
 *
 * The pair list is the stock registry intersected with the factory's own
 * `approvedPairTokens`, because those are the only two authorities that
 * matter: a stock hodl does not recognise cannot be priced or charted, and a
 * token Pons has not approved reverts the launch. Asking the chain also means
 * a stock Pons adds tomorrow appears here without a deploy.
 *
 * Stocks come first and are the default. That is not presentation — a
 * stock-paired launch satisfies `qualifiesForUniverse()` on its own, so it is
 * the one choice that cannot produce a token hodl would then hide.
 */
export async function GET() {
  try {
    const stocks = RWA_REGISTRY.map((entry) => ({
      address: entry.address.toLowerCase(),
      label: entry.ticker,
      name: entry.name,
      logoUrl: entry.logoUrl,
    }));

    const [approvals, fee] = await Promise.all([
      multicallChunked<boolean>(
        stocks.map((stock) => ({
          address: PONS_LAUNCH_FACTORY as `0x${string}`,
          abi: ponsFactoryAbi,
          functionName: "approvedPairTokens",
          args: [stock.address as `0x${string}`],
        })),
        "launch/approvedPairTokens",
      ),
      multicallChunked<bigint>(
        [
          {
            address: PONS_LAUNCH_FACTORY as `0x${string}`,
            abi: ponsFactoryAbi,
            functionName: "launchFee",
          },
        ],
        "launch/launchFee",
      ),
    ]);

    // A read that never landed is not the same as a refusal. Unreachable
    // entries are dropped rather than shown as approved or as rejected.
    const pairs = stocks
      .map((stock, i) => ({stock, result: approvals[i]}))
      .filter(({result}) => result.status === "success" && result.result === true)
      .map(({stock}) => ({...stock, quoteKind: "rwa" as const, isRwa: true}));

    const launchFee =
      fee[0]?.status === "success" ? (fee[0].result as bigint).toString() : null;

    return json({
      /**
       * Pons and Long do not accept the same pairs, so they are returned
       * separately rather than filtered in the sheet.
       *
       * Pons checks `approvedPairTokens`, and the reads above say 63 of the
       * 194 stocks pass. It also takes USDG, and native ETH as `address(0)` —
       * the factory skips the approval check for the zero address, which is
       * why a plain read of `approvedPairTokens(0x0)` says false and is not
       * the question. It does **not** take WETH.
       *
       * Long's Airlock takes any numeraire; WETH is the common one and stock
       * pairs exist on chain too.
       */
      pons: {
        pairs,
        quotePairs: [
          {address: NATIVE_ETH, label: "ETH", quoteKind: "eth", isRwa: false},
          {address: QUOTE_USDG, label: "USDG", quoteKind: "usdg", isRwa: false},
        ],
      },
      long: {
        pairs: stocks.map((stock) => ({
          ...stock,
          quoteKind: "rwa" as const,
          isRwa: true,
        })),
        quotePairs: [
          {address: QUOTE_WETH, label: "ETH", quoteKind: "eth", isRwa: false},
        ],
      },
      launchFee,
      rewardStocks: stocks.map((stock) => stock.label),
    });
  } catch (error) {
    console.error("launch options failed", error);
    return json({error: "Couldn't load launch options."}, 503);
  }
}
