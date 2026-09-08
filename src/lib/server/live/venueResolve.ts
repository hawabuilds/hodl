import type {PublicClient} from "viem";
import {amountOutFromQuoter, feeOnAmount, inputAfterBuyFee, pickBestVenue, PLATFORM_FEE_BPS, type VenueCandidate, type VenueDecision} from "@/lib/venueQuote";
import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";
import {hodlCanExecuteQuote} from "@/lib/liveTrade";
import {CANT_ENTER_FROM_ETH, CANT_EXIT_TO_ETH, entryHopTooThin, isEthish, isHodlQuoteToken, pickBestEthExit, type SwapHop} from "@/lib/swapRoute";
import {rpc} from "./chain";
import {quoteEthToPair, quotePairToEth, quoteV3ExactIn} from "./ethExit";
import {discoverV3Pools, pickBestPool, readV3Pool, V3_QUOTES} from "./v3Pools";
import {quoteV4ExactIn, resolveV4PoolKeys, vanillaV4Candidates, type V4PoolHit} from "./v4Pools";

export interface QuoteRequest {
  token: string;
  /** buy = quote → token; sell = token → quote */
  side: "buy" | "sell";
  amountIn: bigint;
  v4PoolId?: string | null;
  /** Extra quote tokens from the stock's DexScreener pool (not only WETH/USDG). */
  extraQuotes?: string[];
  /** Known V3 pool address when factory discovery would miss a stock/stock pair. */
  v3Pool?: string | null;
  client?: PublicClient;
  /**
   * Hodl buys skim 50 bps off the input before the pool sees it.
   * Universal Router hops must pass false — UR does not take that fee.
   */
  applyBuyFee?: boolean;
}

function v4ZeroForOne(hit: V4PoolHit, tokenIn: string): boolean {
  return hit.key.currency0.toLowerCase() === tokenIn.toLowerCase();
}

function hopFromCandidate(
  candidate: VenueCandidate,
  token: `0x${string}`,
  side: "buy" | "sell",
): SwapHop {
  const tokenIn = side === "buy" ? candidate.quoteToken : token;
  const tokenOut = side === "buy" ? token : candidate.quoteToken;
  return {
    venue: candidate.venue,
    tokenIn,
    tokenOut,
    zeroForOne: candidate.zeroForOne,
    poolKey: candidate.poolKey ?? null,
    v3Fee: candidate.v3Fee ?? null,
  };
}

/**
 * Quote V4 and V3 for this size and pick the better net output.
 *
 * Creator tax on V3 is zero — the hook never runs. That is disclosed on the
 * ticket. It is not a product we market.
 */
export async function gatherVenueCandidates(req: QuoteRequest): Promise<VenueCandidate[]> {
  const client = req.client ?? rpc();
  const token = req.token.toLowerCase() as `0x${string}`;
  const candidates: VenueCandidate[] = [];

  const applyBuyFee = req.applyBuyFee ?? req.side === "buy";
  const quoteIn = applyBuyFee ? inputAfterBuyFee(req.amountIn) : req.amountIn;
  if (quoteIn <= 0n) return [];

  const extraQuotes = (req.extraQuotes ?? [])
    .map((quote) => quote.toLowerCase() as `0x${string}`)
    .filter((quote) => /^0x[0-9a-f]{40}$/.test(quote) && quote !== token);

  let v4Hits = await resolveV4PoolKeys({token, client});
  if (v4Hits.length === 0 && req.v4PoolId) {
    v4Hits = vanillaV4Candidates(
      token,
      extraQuotes.length > 0 ? extraQuotes : [QUOTE_WETH, QUOTE_USDG],
      req.v4PoolId,
    );
  }
  const wantedPool = req.v4PoolId?.toLowerCase();
  const ordered = wantedPool
    ? [
        ...v4Hits.filter((hit) => hit.poolId.toLowerCase() === wantedPool),
        ...v4Hits.filter((hit) => hit.poolId.toLowerCase() !== wantedPool),
      ]
    : v4Hits;
  for (const v4 of ordered) {
    const tokenIn = req.side === "buy" ? v4.quote : token;
    const zeroForOne = v4ZeroForOne(v4, tokenIn);
    const quoted = await quoteV4ExactIn({
      key: v4.key,
      zeroForOne,
      amountIn: quoteIn,
      client,
    });
    if (quoted.ok) {
      candidates.push({
        venue: "v4",
        amountOut: amountOutFromQuoter(quoted.amountOut, v4.creatorTaxBps),
        creatorTaxBps: v4.creatorTaxBps,
        quoteToken: v4.quote,
        label: `${v4.source} fee=${v4.key.fee} tick=${v4.key.tickSpacing}`,
        poolKey: v4.key,
        zeroForOne,
      });
    }
  }

  const v3Hits = await discoverV3Pools([token], client);
  const extraV3Quotes = extraQuotes.filter(
    (quote) => !(V3_QUOTES as readonly string[]).includes(quote),
  );
  if (extraV3Quotes.length > 0) {
    const more = await discoverV3Pools([token], client, extraV3Quotes);
    v3Hits.get(token)?.push(...(more.get(token) ?? []));
  }
  const bestV3 = pickBestPool(v3Hits.get(token) ?? []);
  if (bestV3) {
    const quote = bestV3.quote;
    const tokenIn = req.side === "buy" ? quote : token;
    const tokenOut = req.side === "buy" ? token : quote;
    const amountOut = await quoteV3ExactIn(tokenIn, tokenOut, bestV3.fee, quoteIn, client);
    if (amountOut != null) {
      candidates.push({
        venue: "v3",
        amountOut,
        creatorTaxBps: 0,
        quoteToken: quote,
        label: `QuoterV2 fee=${bestV3.fee}`,
        v3Fee: bestV3.fee,
        v3Pool: bestV3.pool,
      });
    }
  }

  const hintedV3 =
    req.v3Pool && /^0x[0-9a-f]{40}$/.test(req.v3Pool) && req.v3Pool.toLowerCase() !== bestV3?.pool
      ? await readV3Pool(req.v3Pool.toLowerCase() as `0x${string}`, client)
      : null;
  if (hintedV3 && hintedV3.liquidity > 0n && Number.isFinite(hintedV3.fee)) {
    const quote =
      hintedV3.token0 === token
        ? hintedV3.token1
        : hintedV3.token1 === token
          ? hintedV3.token0
          : null;
    if (quote) {
      const tokenIn = req.side === "buy" ? quote : token;
      const tokenOut = req.side === "buy" ? token : quote;
      const amountOut = await quoteV3ExactIn(tokenIn, tokenOut, hintedV3.fee, quoteIn, client);
      if (amountOut != null) {
        candidates.push({
          venue: "v3",
          amountOut,
          creatorTaxBps: 0,
          quoteToken: quote,
          label: `Dex pool fee=${hintedV3.fee}`,
          v3Fee: hintedV3.fee,
          v3Pool: req.v3Pool!.toLowerCase() as `0x${string}`,
        });
      }
    }
  }

  return candidates;
}

/**
 * Quote V4 and V3 for this size and pick the better net output.
 *
 * Creator tax on V3 is zero — the hook never runs. That is disclosed on the
 * ticket. It is not a product we market.
 */
export async function resolveVenue(req: QuoteRequest): Promise<VenueDecision | null> {
  const candidates = await gatherVenueCandidates(req);
  return pickBestVenue(
    candidates,
    undefined,
    req.side !== "buy",
    req.amountIn,
  );
}

export type SellToEthResult =
  | {
      ok: true;
      decision: VenueDecision;
      hops: SwapHop[];
      pairToken: `0x${string}`;
      quoteToken: `0x${string}`;
    }
  | {ok: false; reason: "no_pool"}
  | {ok: false; reason: "no_eth_exit"; error: typeof CANT_EXIT_TO_ETH};

/**
 * Sell quotes in ETH. Doppler / stock-paired tokens hop pair → WETH/ETH.
 * If that hop is missing, fail honestly — do not pay SPCX.
 */
export async function resolveSellToEth(req: QuoteRequest): Promise<SellToEthResult> {
  const token = req.token.toLowerCase() as `0x${string}`;
  const candidates = await gatherVenueCandidates({...req, side: "sell"});
  if (candidates.length === 0) return {ok: false, reason: "no_pool"};

  type Ranked = {
    first: VenueCandidate;
    ethOut: bigint;
    hop2?: SwapHop;
    quoteToken: `0x${string}`;
  };
  const ranked: Ranked[] = [];
  for (const first of candidates) {
    if (first.amountOut <= 0n) continue;
    if (isEthish(first.quoteToken)) {
      ranked.push({first, ethOut: first.amountOut, quoteToken: first.quoteToken});
      continue;
    }
    const exit = await quotePairToEth({
      pairToken: first.quoteToken,
      amountIn: first.amountOut,
      client: req.client,
    });
    if (!exit) continue;
    ranked.push({
      first,
      ethOut: exit.amountOut,
      hop2: exit.hop,
      quoteToken: exit.quoteToken,
    });
  }
  if (ranked.length === 0) {
    return {ok: false, reason: "no_eth_exit", error: CANT_EXIT_TO_ETH};
  }
  ranked.sort((a, b) => (a.ethOut === b.ethOut ? 0 : a.ethOut > b.ethOut ? -1 : 1));
  const win = pickBestEthExit(ranked);
  if (!win) return {ok: false, reason: "no_eth_exit", error: CANT_EXIT_TO_ETH};
  const decided = pickBestVenue([win.first], undefined, true, req.amountIn);
  if (!decided) return {ok: false, reason: "no_pool"};
  const hops: SwapHop[] = [hopFromCandidate(win.first, token, "sell")];
  if (win.hop2) hops.push(win.hop2);
  const hodl = hodlCanExecuteQuote({
    quoteIsNative: win.quoteToken.toLowerCase() === QUOTE_ETH,
    quoteIsWeth: win.quoteToken.toLowerCase() === QUOTE_WETH,
    quoteToken: win.quoteToken,
    pairToken: win.first.quoteToken,
    hops,
  });
  const feeAmount = hodl ? feeOnAmount(win.ethOut) : 0n;
  return {
    ok: true,
    decision: {
      ...decided,
      amountOut: win.ethOut,
      netOut: win.ethOut - feeAmount,
      feeAmount,
      platformFeeBps: hodl ? PLATFORM_FEE_BPS : 0,
      quoteToken: win.quoteToken,
    },
    hops,
    pairToken: win.first.quoteToken,
    quoteToken: win.quoteToken,
  };
}

export type BuyFromEthResult =
  | {
      ok: true;
      decision: VenueDecision;
      hops: SwapHop[];
      pairToken: `0x${string}`;
      quoteToken: `0x${string}`;
    }
  | {ok: false; reason: "no_pool"}
  | {ok: false; reason: "no_eth_entry"; error: typeof CANT_ENTER_FROM_ETH};

/**
 * Buy quotes in ETH. Stock-paired tokens hop WETH/ETH → pair → token.
 * Universal Router does not skim a platform fee on that path.
 */
export async function resolveBuyFromEth(req: QuoteRequest): Promise<BuyFromEthResult> {
  const token = req.token.toLowerCase() as `0x${string}`;
  if (req.amountIn <= 0n) return {ok: false, reason: "no_pool"};

  const probe = await gatherVenueCandidates({
    ...req,
    side: "buy",
    amountIn: req.amountIn > 10n ** 12n ? 10n ** 12n : req.amountIn,
    applyBuyFee: false,
  });
  const pairs = new Set<`0x${string}`>();
  for (const extra of req.extraQuotes ?? []) {
    const quote = extra.toLowerCase() as `0x${string}`;
    if (/^0x[0-9a-f]{40}$/.test(quote) && quote !== token && !isHodlQuoteToken(quote)) {
      pairs.add(quote);
    }
  }
  for (const candidate of probe) {
    const pair = candidate.quoteToken.toLowerCase() as `0x${string}`;
    if (!isHodlQuoteToken(pair)) pairs.add(pair);
  }
  if (pairs.size === 0) {
    return probe.length === 0
      ? {ok: false, reason: "no_pool"}
      : {ok: false, reason: "no_eth_entry", error: CANT_ENTER_FROM_ETH};
  }

  type Ranked = {
    tokenOut: bigint;
    hop1: SwapHop;
    hop2: SwapHop;
    pairToken: `0x${string}`;
    quoteToken: `0x${string}`;
    second: VenueCandidate;
  };
  const ranked: Ranked[] = [];
  for (const pair of pairs) {
    const entry = await quoteEthToPair({
      pairToken: pair,
      amountIn: req.amountIn,
      client: req.client,
    });
    if (!entry || entry.amountOut <= 0n) continue;
    // A dust ETH/stock book still quotes a positive amountOut (the last
    // share crumbs). Round-trip those crumbs; if they are not worth the
    // ETH, this hop donates the input to the pool manager.
    const entryBack = await quotePairToEth({
      pairToken: pair,
      amountIn: entry.amountOut,
      client: req.client,
    });
    if (!entryBack || entryHopTooThin(req.amountIn, entryBack.amountOut)) continue;
    const second = await gatherVenueCandidates({
      ...req,
      side: "buy",
      amountIn: entry.amountOut,
      extraQuotes: [pair],
      applyBuyFee: false,
    });
    const matches = second.filter((row) => row.quoteToken.toLowerCase() === pair);
    matches.sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1));
    const best2 = matches[0];
    if (!best2 || best2.amountOut <= 0n) continue;
    const hop2 = hopFromCandidate(best2, token, "buy");
    hop2.amountIn = entry.amountOut.toString();
    ranked.push({
      tokenOut: best2.amountOut,
      hop1: entry.hop,
      hop2,
      pairToken: pair,
      quoteToken: entry.quoteToken,
      second: best2,
    });
  }
  if (ranked.length === 0) {
    return {ok: false, reason: "no_eth_entry", error: CANT_ENTER_FROM_ETH};
  }
  ranked.sort((a, b) => (a.tokenOut === b.tokenOut ? 0 : a.tokenOut > b.tokenOut ? -1 : 1));
  const win = ranked[0];
  const decided = pickBestVenue([win.second], 0, false, req.amountIn);
  if (!decided) return {ok: false, reason: "no_pool"};
  return {
    ok: true,
    decision: {
      ...decided,
      amountOut: win.tokenOut,
      netOut: win.tokenOut,
      feeAmount: 0n,
      platformFeeBps: 0,
      quoteToken: win.quoteToken,
    },
    hops: [win.hop1, win.hop2],
    pairToken: win.pairToken,
    quoteToken: win.quoteToken,
  };
}
