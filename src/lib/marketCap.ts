import type {Asset} from "./types";

/**
 * The one market-cap calculation in this app.
 *
 * Market cap is circulating supply times price, and the only thing that moves
 * between one reading and the next is the price. Every surface that shows a cap
 * — the feed row, the chart header, the info panel — goes through here, against
 * the same supply and the same price, so they cannot disagree.
 *
 * They used to. The feed printed the server's snapshot, the chart header
 * recomputed its own figure from the live tape, and the info panel below that
 * header printed the server's snapshot again — three renderings of one number,
 * two of them on the same screen. Measured against production, every token
 * sampled disagreed between the feed and its own page, by up to twelve percent,
 * and the gap was entirely price: the two surfaces were reading the same pool
 * through separately timed caches.
 */

/**
 * Circulating supply behind an asset's cap, or null when nothing publishes one.
 *
 * Null is not zero and must not be treated as it. It means the server could not
 * read supply from the chain and fell back to the indexer's own market-cap
 * figure, which is not supply times this price and cannot be rescaled by one.
 */
export function supplyOf(asset: Asset): number | null {
  const supply = asset.circulatingSupply;
  if (typeof supply !== "number") return null;
  if (!Number.isFinite(supply) || supply <= 0) return null;
  return supply;
}

/**
 * An asset's market cap at a given price.
 *
 * With a known supply this is the product, so a fresher price gives a fresher
 * cap. Without one the server's figure is returned unchanged — rescaling a
 * number that was never supply times price produces a number that means
 * nothing, and on a token with a billion units it produced caps in the
 * billions.
 */
export function marketCapAt(asset: Asset, priceUsd: number): number | null {
  const supply = supplyOf(asset);
  if (supply === null) return asset.marketCapUsd;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return asset.marketCapUsd;
  return supply * priceUsd;
}
