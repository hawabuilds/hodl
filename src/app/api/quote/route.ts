import {formatEther, formatUnits} from "viem";
import {isAddress, normalizeAddress} from "@/lib/address";
import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";
import {humanToRaw, quoteTokenDecimals, usdgRawFromUsd} from "@/lib/quoteAmounts";
import {CANT_ENTER_FROM_ETH, CANT_EXIT_TO_ETH, isEthish, isHodlQuoteToken, type SwapHop} from "@/lib/swapRoute";
import {
  LIVE_BUY_OVER_CAP,
  liveBuyOverCap,
  priceImpactBps,
  quotedPairOut,
} from "@/lib/tradePolicy";
import {lpFeeLabel, venueTicketCopy} from "@/lib/venueQuote";
import {json} from "@/lib/server/http";
import {quotePriceUsd} from "@/lib/server/quotePrice";
import {erc20Abi, rpc} from "@/lib/server/live/chain";
import {poolFor} from "@/lib/server/live/market";
import {ethUsd} from "@/lib/server/live/onchainPrice";
import {RWA_BY_ADDRESS} from "@/lib/server/live/robinhood";
import {
  resolveBuyFromEth,
  resolveBuyPaying,
  resolveSellReceiving,
  resolveSellToEth,
  resolveVenue,
  type TradeCurrency,
} from "@/lib/server/live/venueResolve";

export const dynamic = "force-dynamic";

async function tokenDecimals(token: `0x${string}`): Promise<number> {
  try {
    return Number(
      await rpc().readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    );
  } catch {
    return 18;
  }
}

async function sizedAmountIn(opts: {
  side: "buy" | "sell";
  amountUsd: number;
  amountInParam: bigint | null;
}): Promise<bigint> {
  if (opts.amountInParam != null && opts.amountInParam > 0n) {
    return opts.amountInParam;
  }
  if (Number.isFinite(opts.amountUsd) && opts.amountUsd > 0) {
    return opts.side === "buy" ? usdgRawFromUsd(opts.amountUsd) : 10n ** 16n;
  }
  return 10n ** 16n;
}

/** Convert a dollar size into raw units of the venue's quote token. */
async function buyAmountIn(
  amountUsd: number,
  quoteToken: `0x${string}`,
): Promise<bigint | null> {
  if (quoteToken === QUOTE_USDG) return usdgRawFromUsd(amountUsd);
  if (quoteToken === QUOTE_ETH || quoteToken === QUOTE_WETH) {
    const eth = await ethUsd();
    if (eth == null || eth <= 0) return null;
    return humanToRaw(amountUsd / eth, 18);
  }
  const price = await quotePriceUsd(quoteToken);
  if (price == null || price <= 0) return null;
  return humanToRaw(amountUsd / price, await tokenDecimals(quoteToken));
}

/** The dollar size of a buy's input, from the request or the input itself. */
async function amountInUsd(
  amountIn: bigint,
  payToken: `0x${string}`,
  amountUsd: number,
): Promise<number | null> {
  if (Number.isFinite(amountUsd) && amountUsd > 0) return amountUsd;
  return tokenAmountUsd(amountIn, payToken);
}

/** USD value of a raw amount of ETH, WETH, USDG or a priced quote token. */
async function tokenAmountUsd(
  amount: bigint,
  token: `0x${string}`,
): Promise<number | null> {
  if (token === QUOTE_USDG) return Number(formatUnits(amount, 6));
  if (isEthish(token)) {
    const eth = await ethUsd();
    return eth && eth > 0 ? Number(formatEther(amount)) * eth : null;
  }
  const price = await quotePriceUsd(token);
  return price && price > 0 ? Number(formatUnits(amount, await tokenDecimals(token))) * price : null;
}

/**
 * Per-size venue quote. Does not persist a venue on the token.
 *
 * Returns the PoolKey / V3 fee the client encodes. Confirm must sign that
 * payload — this route never writes a book.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawToken = url.searchParams.get("token") ?? "";
  const token = isAddress(rawToken) ? normalizeAddress(rawToken) : "";
  const side = url.searchParams.get("side") === "sell" ? "sell" : "buy";
  if (!token) {
    return json({error: "token required"}, 400);
  }
  // A buy sized in dollars is checked against the cap before any pool lookup.
  if (side === "buy" && liveBuyOverCap(Number(url.searchParams.get("amountUsd") ?? ""))) {
    return json({error: LIVE_BUY_OVER_CAP}, 400);
  }

  const rwa = RWA_BY_ADDRESS.get(token);
  const pool = rwa
    ? await poolFor("rwa", rwa.ticker)
    : await poolFor("token", token);
  const v4PoolId =
    pool?.pool && /^0x[0-9a-f]{64}$/.test(pool.pool) ? pool.pool : null;
  const v3PoolHint =
    pool?.pool && /^0x[0-9a-f]{40}$/.test(pool.pool) ? pool.pool : null;
  const extraQuotes =
    pool?.quote && /^0x[0-9a-f]{40}$/.test(pool.quote) ? [pool.quote] : [];

  const amountUsd = Number(url.searchParams.get("amountUsd") ?? "");
  const rawAmountIn = url.searchParams.get("amountIn") ?? "";
  const amountInParam = /^\d+$/.test(rawAmountIn) ? BigInt(rawAmountIn) : null;

  // The ticket's currency choice: what a buy pays with, what a sell pays out.
  // Absent, the venue's own quote currency decides (the original behaviour).
  const currencyParam = url.searchParams.get(side === "buy" ? "pay" : "receive");
  const currency: TradeCurrency | null =
    currencyParam === "eth" || currencyParam === "usdg" ? currencyParam : null;

  let amountIn = await sizedAmountIn({side, amountUsd, amountInParam});
  let hops: SwapHop[] = [];
  let pairToken: `0x${string}` | null = null;

  let sized = null as Awaited<ReturnType<typeof resolveVenue>>;
  if (currency) {
    if (side === "buy" && (amountInParam == null || amountInParam <= 0n)) {
      const sizedIn =
        Number.isFinite(amountUsd) && amountUsd > 0
          ? await buyAmountIn(amountUsd, currency === "usdg" ? QUOTE_USDG : QUOTE_WETH)
          : null;
      if (sizedIn == null || sizedIn <= 0n) return json({venue: null});
      amountIn = sizedIn;
    }
    const venueReq = {token, amountIn, v4PoolId, extraQuotes, v3Pool: v3PoolHint};
    const routed =
      side === "buy"
        ? await resolveBuyPaying({...venueReq, side: "buy", pay: currency})
        : await resolveSellReceiving({...venueReq, side: "sell", receive: currency});
    if (!routed.ok) {
      return routed.reason === "no_route" ? json({error: routed.error}) : json({venue: null});
    }
    sized = routed.decision;
    hops = routed.hops;
    pairToken = routed.pairToken;
  } else if (side === "sell") {
    const sold = await resolveSellToEth({
      token,
      side: "sell",
      amountIn,
      v4PoolId,
      extraQuotes,
      v3Pool: v3PoolHint,
    });
    if (!sold.ok) {
      if (sold.reason === "no_eth_exit") return json({error: CANT_EXIT_TO_ETH});
      return json({venue: null});
    }
    sized = sold.decision;
    hops = sold.hops;
    pairToken = sold.pairToken;
  } else {
    sized = await resolveVenue({
      token,
      side,
      amountIn,
      v4PoolId,
      extraQuotes,
      v3Pool: v3PoolHint,
    });

    if (sized && isHodlQuoteToken(sized.quoteToken)) {
      // Probe used USDG units. Resize to the winning Hodl quote (WETH, ETH, USDG).
      if (
        amountInParam == null &&
        Number.isFinite(amountUsd) &&
        amountUsd > 0 &&
        sized.quoteToken !== QUOTE_USDG
      ) {
        const resized = await buyAmountIn(amountUsd, sized.quoteToken);
        if (resized != null && resized > 0n) {
          amountIn = resized;
          const retry = await resolveVenue({
            token,
            side,
            amountIn,
            v4PoolId,
            extraQuotes,
            v3Pool: v3PoolHint,
          });
          if (retry) sized = retry;
        }
      }
      pairToken = sized.quoteToken;
    } else {
      const ethAmount =
        amountInParam != null && amountInParam > 0n
          ? amountInParam
          : Number.isFinite(amountUsd) && amountUsd > 0
            ? await buyAmountIn(amountUsd, QUOTE_WETH)
            : null;
      if (ethAmount == null || ethAmount <= 0n) {
        return sized ? json({error: CANT_ENTER_FROM_ETH}) : json({venue: null});
      }
      amountIn = ethAmount;
      const bought = await resolveBuyFromEth({
        token,
        side: "buy",
        amountIn: ethAmount,
        v4PoolId,
        extraQuotes,
        v3Pool: v3PoolHint,
        applyBuyFee: false,
      });
      if (!bought.ok) {
        if (bought.reason === "no_eth_entry") {
          return json({error: bought.error ?? CANT_ENTER_FROM_ETH});
        }
        return json({venue: null});
      }
      sized = bought.decision;
      hops = bought.hops;
      pairToken = bought.pairToken;
    }
  }
  if (!sized) return json({venue: null});

  // The $100 trade cap, as HodlRouter measures it: a buy by what it pays.
  // Checked on every route, so an over-cap trade never gets a quote to sign.
  if (side === "buy") {
    const inUsd = await amountInUsd(amountIn, sized.quoteToken, amountUsd);
    if (inUsd != null && liveBuyOverCap(inUsd)) return json({error: LIVE_BUY_OVER_CAP}, 400);
  }

  const decimals = await tokenDecimals(token as `0x${string}`);
  const copy = venueTicketCopy(sized);
  const venueLabel = hops.length > 1
    ? `Uniswap ${hops.map((hop) => (hop.venue === "v4" ? "V4" : "V3")).join(" → ")}`
    : copy.venue;
  const quoteIsNative = sized.quoteToken === QUOTE_ETH;
  const quoteIsWeth = sized.quoteToken === QUOTE_WETH;
  const quoteSymbol = side === "sell" && isEthish(sized.quoteToken)
    ? "ETH"
    : quoteIsNative || quoteIsWeth
      ? "ETH"
      : sized.quoteToken === QUOTE_USDG
        ? "USDG"
        : (RWA_BY_ADDRESS.get(sized.quoteToken)?.ticker ?? "tokens");
  let quoteDecimals = 18;
  try {
    quoteDecimals = quoteTokenDecimals(sized.quoteToken);
  } catch {
    quoteDecimals = await tokenDecimals(sized.quoteToken);
  }
  const outDecimals = side === "buy" ? decimals : quoteDecimals;

  let usdOut: number | null = null;
  let impactBps: number | null = null;
  if (side === "buy") {
    const eth = await ethUsd();
    const inUsd = await amountInUsd(amountIn, sized.quoteToken, amountUsd);

    if (hops.length > 1 && pairToken) {
      const pairUsd = isEthish(pairToken) ? eth : await quotePriceUsd(pairToken);
      if (pairUsd != null && pairUsd > 0) {
        const pairDec = await tokenDecimals(pairToken);
        usdOut = Number(formatUnits(quotedPairOut(hops), pairDec)) * pairUsd;
      }
    } else if (hops.length <= 1) {
      // Single-hop buys (direct WETH/USDG/V4 pool). Value the quoted tokens by
      // round-tripping them through the same venue — not the page mark, which can
      // lag a fresh pool and falsely show 100% impact with a non-zero token out.
      const netOut = BigInt(sized.netOut);
      if (netOut > 0n) {
        const sold = await resolveVenue({
          token,
          side: "sell",
          amountIn: netOut,
          v4PoolId,
          extraQuotes,
          v3Pool: v3PoolHint,
          applyBuyFee: false,
        });
        if (sold && sold.netOut > 0n) {
          if (isEthish(sized.quoteToken)) {
            if (eth != null && eth > 0) {
              usdOut = Number(formatEther(sold.netOut)) * eth;
            }
          } else if (sized.quoteToken === QUOTE_USDG) {
            usdOut = Number(formatUnits(sold.netOut, 6));
          } else {
            const quoteUsd = await quotePriceUsd(sized.quoteToken);
            if (quoteUsd != null && quoteUsd > 0) {
              const quoteDec = await tokenDecimals(sized.quoteToken);
              usdOut = Number(formatUnits(sold.netOut, quoteDec)) * quoteUsd;
            }
          }
        }
      }
    }
    if (inUsd != null && usdOut != null) {
      impactBps = priceImpactBps(inUsd, usdOut);
    }
  }

  return json({
    venue: sized.venue,
    venueLabel,
    creatorTax: copy.creatorTax,
    creatorTaxBps: sized.creatorTaxBps,
    amountIn: amountIn.toString(),
    amountOut: sized.amountOut.toString(),
    netOut: sized.netOut.toString(),
    feeAmount: sized.feeAmount.toString(),
    feeToken: side === "buy" ? sized.quoteToken : sized.quoteToken,
    feeBps: sized.platformFeeBps,
    lpFee: lpFeeLabel(sized),
    lpFeeBps: sized.venue === "v3" && sized.v3Fee != null ? sized.v3Fee / 100 : sized.poolKey?.fee === 0 ? 0 : null,
    quoteToken: sized.quoteToken,
    label: sized.label,
    tokenDecimals: decimals,
    quoteDecimals,
    outDecimals,
    zeroForOne: sized.zeroForOne ?? false,
    quoteIsNative,
    quoteIsWeth,
    quoteSymbol,
    poolKey: sized.poolKey ?? null,
    v3Fee: sized.v3Fee ?? null,
    v3Pool: sized.v3Pool ?? null,
    pairToken,
    hops,
    usdOut,
    priceImpactBps: impactBps,
    currency,
  });
}
