import {db, hasDatabase} from "./db";
import {cachedPage} from "./live/cache";

/**
 * The most active traders on HODL — most trades placed through the app in the
 * last 30 days — for Home's "People to follow" when someone follows nobody.
 * Rebuilt at most every 10 minutes; the page filters out the reader and
 * anyone they already follow.
 */
export interface SuggestedTrader {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  trades: number;
  /** What they trade most, by symbol, busiest first. */
  symbols: string[];
}

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX = 8;

export function suggestedTraders(): Promise<SuggestedTrader[]> {
  return cachedPage("page:suggested-traders", 10 * 60_000, async () => {
    if (!hasDatabase) return [];
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const {data, error} = await db()
      .from("hodl_trades")
      .select("user_id, symbol")
      .gte("traded_at", since)
      .order("traded_at", {ascending: false})
      .limit(5_000);
    if (error) throw new Error(error.message);
    const byUser = new Map<string, {trades: number; symbols: Map<string, number>}>();
    for (const row of (data ?? []) as {user_id: string; symbol: string}[]) {
      const entry = byUser.get(row.user_id) ?? {trades: 0, symbols: new Map()};
      entry.trades += 1;
      entry.symbols.set(row.symbol, (entry.symbols.get(row.symbol) ?? 0) + 1);
      byUser.set(row.user_id, entry);
    }
    const top = [...byUser.entries()].sort((a, b) => b[1].trades - a[1].trades).slice(0, MAX * 2);
    if (top.length === 0) return [];
    const {data: users} = await db()
      .from("users")
      .select("id, handle, display_name, pfp_url")
      .in("id", top.map(([id]) => id));
    const byId = new Map(
      ((users ?? []) as {id: string; handle: string | null; display_name: string | null; pfp_url: string | null}[]).map(
        (user) => [user.id, user],
      ),
    );
    return top
      .flatMap(([id, entry]): SuggestedTrader[] => {
        const user = byId.get(id);
        if (!user?.handle) return [];
        return [
          {
            handle: user.handle,
            displayName: user.display_name || user.handle,
            pfpUrl: user.pfp_url,
            trades: entry.trades,
            symbols: [...entry.symbols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([symbol]) => symbol),
          },
        ];
      })
      .slice(0, MAX);
  });
}
