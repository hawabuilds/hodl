import type {Holding} from "@/lib/types";
import {balancesFor, nativeBalance} from "./chain";
import {listRwas, listTokens} from "./market";

/**
 * What a wallet actually holds, priced.
 *
 * Only the tradeable universe is looked up — anything else is not listed in
 * this app and has no price here, so showing it would be a row nobody can act
 * on.
 *
 * Cost basis is deliberately absent. It comes from this platform's own fills,
 * and a balance that arrived from somewhere else has none; inventing one would
 * put a fabricated profit on the screen.
 *
 * Shared by the signed-in portfolio and by other people's profiles, which is
 * the point: a profile showing real holdings has to read them the same way the
 * owner's own page does, or the two disagree.
 */
export async function holdingsFor(wallet: string): Promise<{
  holdings: Holding[];
  ethBalance: number;
  degraded: boolean;
}> {
  const [rwas, tokens] = await Promise.all([listRwas(), listTokens()]);

  const universe = [
    ...rwas.map((asset) => ({
      kind: "rwa" as const,
      id: asset.id,
      symbol: asset.ticker,
      name: asset.name,
      logoUrl: asset.logoUrl,
      address: asset.contractAddress,
      priceUsd: asset.priceUsd,
      changePct: asset.changePct,
    })),
    ...tokens.map((asset) => ({
      kind: "token" as const,
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.imageUrl,
      address: asset.address,
      priceUsd: asset.priceUsd,
      changePct: asset.changePct,
    })),
  ];

  let balances = new Map<string, number>();
  let eth = 0;

  try {
    [balances, eth] = await Promise.all([
      balancesFor(
        wallet,
        universe.map((asset) => ({address: asset.address, decimals: 18})),
      ),
      nativeBalance(wallet).catch(() => 0),
    ]);
  } catch (error) {
    console.error("balance read failed", error);
    return {holdings: [], ethBalance: 0, degraded: true};
  }

  const holdings: Holding[] = [];

  for (const asset of universe) {
    const amount = balances.get(asset.address.toLowerCase());
    if (!amount) continue;
    holdings.push({
      kind: asset.kind,
      assetId: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      logoUrl: asset.logoUrl,
      amount,
      valueUsd: amount * asset.priceUsd,
      changePct: asset.changePct,
      costUsd: 0,
    });
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return {holdings, ethBalance: eth, degraded: false};
}
