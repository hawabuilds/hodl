import {QUOTE_ASSETS} from "./live/dexscreener";
import {RWA_BY_ADDRESS, quoteFor} from "./live/robinhood";

/**
 * USD price of the pool's quote asset, for sizing a fill from the quote leg.
 *
 * DexScreener and the indexer value swaps from what moved on the quote side
 * (USDG face value, or shares × Robinhood mid). Using the page token's spot
 * price instead understates or overstates the USD column on RWA-paired pools.
 */
export async function quotePriceUsd(quoteAddress: string): Promise<number | null> {
  const quote = quoteAddress.toLowerCase();
  const symbol = QUOTE_ASSETS.get(quote);

  if (symbol === "USDG") return 1;

  const rwa = RWA_BY_ADDRESS.get(quote);
  if (rwa) {
    const live = await quoteFor(rwa.ticker);
    return live?.priceUsd ?? null;
  }

  // WETH / ETH and anything else: caller falls back to indexer or token spot.
  return null;
}
