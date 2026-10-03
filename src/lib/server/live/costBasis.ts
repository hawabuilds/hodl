import {db, hasDatabase} from "@/lib/server/db";
import type {Holding, PortfolioPnl} from "@/lib/types";

/**
 * What the holdings cost, from the fills saved in `hodl_trades`.
 *
 * Average cost: every buy adds its dollars and units to the pile, every sell
 * takes units off at the pile's average price, and what that sale made over
 * the average is realised profit. A holding's basis is the average price
 * times what the wallet holds now.
 *
 * A basis is only claimed when the saved fills explain the balance. A buy
 * whose dollar leg could not be read, or a balance larger than what was
 * bought here (tokens that arrived from elsewhere), leaves the basis null —
 * null is not zero, and a zero basis would print the whole position as
 * profit.
 */

export interface TradeRow {
  side: "buy" | "sell";
  kind: "token" | "rwa";
  asset_id: string;
  token_amount: number;
  usd: number | null;
  traded_at: string;
}

/** Room for rounding between a receipt's amount and a balance read. */
const BALANCE_SLACK = 1.02;

const keyOf = (kind: string, assetId: string) => `${kind}:${assetId.toLowerCase()}`;

export function applyCostBasis(
  holdings: readonly Holding[],
  trades: readonly TradeRow[],
): {holdings: Holding[]; pnl: PortfolioPnl | null} {
  if (trades.length === 0) return {holdings: [...holdings], pnl: null};

  const piles = new Map<string, {units: number; cost: number; known: boolean}>();
  let realizedUsd = 0;
  let boughtUsd = 0;
  let firstTradeAt: string | null = null;

  const ordered = [...trades].sort((a, b) => a.traded_at.localeCompare(b.traded_at));
  for (const trade of ordered) {
    const amount = Number(trade.token_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const usd = trade.usd == null ? null : Number(trade.usd);
    firstTradeAt ??= trade.traded_at;
    const key = keyOf(trade.kind, trade.asset_id);
    const pile = piles.get(key) ?? {units: 0, cost: 0, known: true};
    piles.set(key, pile);
    if (trade.side === "buy") {
      if (usd == null || !Number.isFinite(usd)) {
        pile.known = false;
      } else {
        pile.cost += usd;
        boughtUsd += usd;
      }
      pile.units += amount;
      continue;
    }
    if (pile.units <= 0) continue;
    const sold = Math.min(amount, pile.units);
    const average = pile.cost / pile.units;
    if (pile.known && usd != null && Number.isFinite(usd)) {
      // A partial fill of a bigger sell: only the matched units count.
      realizedUsd += usd * (sold / amount) - average * sold;
    }
    pile.cost -= average * sold;
    pile.units -= sold;
  }

  const priced = holdings.map((holding) => {
    const pile = piles.get(keyOf(holding.kind, holding.assetId));
    if (!pile || !pile.known || pile.units <= 0) return holding;
    if (holding.amount > pile.units * BALANCE_SLACK) return holding;
    return {...holding, costUsd: (pile.cost / pile.units) * holding.amount};
  });

  return {holdings: priced, pnl: {realizedUsd, boughtUsd, firstTradeAt}};
}

/** The saved fills for these wallets, oldest first. */
export async function tradesFor(wallets: readonly string[]): Promise<TradeRow[]> {
  if (!hasDatabase || wallets.length === 0) return [];
  const {data, error} = await db()
    .from("hodl_trades")
    .select("side, kind, asset_id, token_amount, usd, traded_at")
    .in("wallet", [...wallets])
    .order("traded_at", {ascending: true})
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as TradeRow[];
}
