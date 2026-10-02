import type {QueryClient} from "@tanstack/react-query";
import {rememberRecentTrade} from "./localStore";
import type {AssetKind} from "./types";

/**
 * After a buy or sell confirms: the portfolio re-reads the wallet now, with
 * the traded token in its hint, instead of at its next minute's refresh.
 */
export function refreshPortfolioAfterTrade(queryClient: QueryClient, kind: AssetKind, assetId: string): void {
  if (kind === "token") rememberRecentTrade(assetId);
  for (const key of ["portfolio-tokens", "portfolio-native", "portfolio-history"]) {
    void queryClient.invalidateQueries({queryKey: [key]});
  }
}
