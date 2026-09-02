import type {NextRequest} from "next/server";
import {badRequest, json} from "@/lib/server/http";
import {balancesFor, nativeBalance} from "@/lib/server/live/chain";
import {listRwas, listTokens} from "@/lib/server/live/market";
import type {Holding} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * What a wallet actually holds, priced.
 *
 * Only the tradeable universe is looked up — anything else is not listed here
 * and has no price, so showing it would be a row nobody can act on.
 *
 * Cost basis is deliberately absent. It comes from this platform's own fills,
 * and a balance that arrived from somewhere else has none; inventing one would
 * put a fabricated profit on the screen.
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return badRequest("A wallet address is required.");
  }

  const [rwas, tokens] = await Promise.all([listRwas(), listTokens()]);

  const universe = [
    ...rwas.map((a) => ({
      kind: "rwa" as const,
      id: a.id,
      symbol: a.ticker,
      name: a.name,
      address: a.contractAddress,
      decimals: 18,
      priceUsd: a.priceUsd,
      changePct: a.changePct,
    })),
    ...tokens.map((a) => ({
      kind: "token" as const,
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      address: a.address,
      decimals: 18,
      priceUsd: a.priceUsd,
      changePct: a.changePct,
    })),
  ];

  let balances = new Map<string, number>();
  let eth = 0;
  try {
    [balances, eth] = await Promise.all([
      balancesFor(wallet, universe.map((a) => ({address: a.address, decimals: a.decimals}))),
      nativeBalance(wallet).catch(() => 0),
    ]);
  } catch (error) {
    console.error("balance read failed", error);
    return json({holdings: [], ethBalance: 0, degraded: true});
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
      logoUrl: null,
      amount,
      valueUsd: amount * asset.priceUsd,
      changePct: asset.changePct,
      costUsd: 0,
    });
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return json({holdings, ethBalance: eth, degraded: false});
}
