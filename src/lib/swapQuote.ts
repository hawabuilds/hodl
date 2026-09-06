import {QUOTE_ETH, QUOTE_USDG, QUOTE_WETH} from "./contracts";
import type {SwapHop} from "./swapRoute";
import type {V4PoolKey} from "./v4Encoding";
import type {VenueId} from "./venueQuote";

/**
 * Sized venue quote the ticket encodes against.
 *
 * `amountIn` is the exact raw input `resolveVenue` quoted. Confirm must use
 * this figure, not a second local conversion, or the encoded swap and the
 * quoted output disagree.
 */
export interface SwapQuote {
  venue: VenueId;
  venueLabel: string;
  creatorTax: string;
  creatorTaxBps: number;
  amountIn: string;
  amountOut: string;
  netOut: string;
  feeAmount: string;
  feeToken: `0x${string}` | null;
  feeBps: number;
  lpFee: string;
  lpFeeBps: number | null;
  quoteToken: `0x${string}`;
  tokenDecimals: number;
  quoteDecimals: number;
  outDecimals: number;
  zeroForOne: boolean;
  quoteIsNative: boolean;
  quoteIsWeth: boolean;
  /** ETH, USDG, or the stock ticker — never a guessed ETH label. */
  quoteSymbol: string;
  poolKey: V4PoolKey | null;
  v3Fee: number | null;
  v3Pool: `0x${string}` | null;
  /** Immediate pool pair (SPCX, USDG, IBM…). Final `quoteToken` is ETH/WETH on sells. */
  pairToken: `0x${string}` | null;
  hops: SwapHop[];
}

export type QuoteResult =
  | {ok: true; quote: SwapQuote}
  | {ok: false; venue: null; error?: string};

function namedQuoteSymbol(row: Record<string, unknown>, quoteToken: string): string {
  const named = typeof row.quoteSymbol === "string" ? row.quoteSymbol.trim() : "";
  if (named) return named;
  if (Boolean(row.quoteIsNative) || Boolean(row.quoteIsWeth)) return "ETH";
  if (quoteToken === QUOTE_USDG) return "USDG";
  if (quoteToken === QUOTE_WETH) return "ETH";
  return "tokens";
}

function asHop(value: unknown): SwapHop | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.venue !== "v4" && row.venue !== "v3") return null;
  const tokenIn = String(row.tokenIn ?? "").toLowerCase();
  const tokenOut = String(row.tokenOut ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(tokenIn) || !/^0x[0-9a-f]{40}$/.test(tokenOut)) {
    return null;
  }
  const hop: SwapHop = {
    venue: row.venue,
    tokenIn: tokenIn as `0x${string}`,
    tokenOut: tokenOut as `0x${string}`,
  };
  if (typeof row.amountIn === "string" && /^\d+$/.test(row.amountIn)) {
    hop.amountIn = row.amountIn;
  }
  if (typeof row.zeroForOne === "boolean") hop.zeroForOne = row.zeroForOne;
  const poolKey = asPoolKey(row.poolKey);
  if (poolKey) hop.poolKey = poolKey;
  const v3Fee = Number(row.v3Fee);
  if (Number.isFinite(v3Fee)) hop.v3Fee = v3Fee;
  if (row.venue === "v4" && !hop.poolKey) return null;
  if (row.venue === "v3" && hop.v3Fee == null) return null;
  return hop;
}

function asHops(value: unknown): SwapHop[] {
  if (!Array.isArray(value)) return [];
  const hops: SwapHop[] = [];
  for (const row of value) {
    const hop = asHop(row);
    if (!hop) return [];
    hops.push(hop);
  }
  return hops;
}

function asPoolKey(value: unknown): V4PoolKey | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const currency0 = String(row.currency0 ?? "");
  const currency1 = String(row.currency1 ?? "");
  const hooks = String(row.hooks ?? "");
  const fee = Number(row.fee);
  const tickSpacing = Number(row.tickSpacing);
  if (!/^0x[0-9a-fA-F]{40}$/.test(currency0)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(currency1)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(hooks)) return null;
  if (!Number.isFinite(fee) || !Number.isFinite(tickSpacing)) return null;
  return {
    currency0: currency0.toLowerCase() as `0x${string}`,
    currency1: currency1.toLowerCase() as `0x${string}`,
    fee,
    tickSpacing,
    hooks: hooks.toLowerCase() as `0x${string}`,
  };
}

export function parseSwapQuote(body: unknown): QuoteResult {
  if (!body || typeof body !== "object") return {ok: false, venue: null};
  const row = body as Record<string, unknown>;
  if (typeof row.error === "string" && row.error) {
    return {ok: false, venue: null, error: row.error};
  }
  if (row.venue !== "v4" && row.venue !== "v3") {
    return {ok: false, venue: null};
  }
  const amountIn = String(row.amountIn ?? "");
  const amountOut = String(row.amountOut ?? "");
  const quoteToken = String(row.quoteToken ?? "").toLowerCase();
  if (!/^\d+$/.test(amountIn) || !/^\d+$/.test(amountOut)) {
    return {ok: false, venue: null};
  }
  if (!/^0x[0-9a-f]{40}$/.test(quoteToken)) {
    return {ok: false, venue: null};
  }
  const poolKey = row.venue === "v4" ? asPoolKey(row.poolKey) : null;
  if (row.venue === "v4" && !poolKey) return {ok: false, venue: null};
  const v3Fee = Number(row.v3Fee);
  if (row.venue === "v3" && !Number.isFinite(v3Fee)) {
    return {ok: false, venue: null};
  }
  const hops = asHops(row.hops);
  const pairRaw = String(row.pairToken ?? "").toLowerCase();
  const pairToken = /^0x[0-9a-f]{40}$/.test(pairRaw)
    ? (pairRaw as `0x${string}`)
    : null;

  return {
    ok: true,
    quote: {
      venue: row.venue,
      venueLabel: String(row.venueLabel ?? (row.venue === "v4" ? "Uniswap V4" : "Uniswap V3")),
      creatorTax: String(row.creatorTax ?? ""),
      creatorTaxBps: Number(row.creatorTaxBps ?? 0),
      amountIn,
      amountOut,
      netOut: String(row.netOut ?? amountOut),
      feeAmount: String(row.feeAmount ?? "0"),
      feeToken: typeof row.feeToken === "string" && /^0x[0-9a-f]{40}$/.test(String(row.feeToken).toLowerCase())
        ? (String(row.feeToken).toLowerCase() as `0x${string}`)
        : null,
      feeBps: Number(row.feeBps ?? 50),
      lpFee: String(row.lpFee ?? ""),
      lpFeeBps: Number.isFinite(Number(row.lpFeeBps)) ? Number(row.lpFeeBps) : null,
      quoteToken: quoteToken as `0x${string}`,
      tokenDecimals: Number(row.tokenDecimals ?? 18),
      quoteDecimals: Number(row.quoteDecimals ?? 18),
      outDecimals: Number(row.outDecimals ?? 18),
      zeroForOne: Boolean(row.zeroForOne),
      quoteIsNative: Boolean(row.quoteIsNative) || quoteToken === QUOTE_ETH,
      quoteIsWeth: Boolean(row.quoteIsWeth) || quoteToken === QUOTE_WETH,
      quoteSymbol: namedQuoteSymbol(row, quoteToken),
      poolKey,
      v3Fee: Number.isFinite(v3Fee) ? v3Fee : null,
      v3Pool: typeof row.v3Pool === "string" ? (row.v3Pool as `0x${string}`) : null,
      pairToken,
      hops,
    },
  };
}

export async function fetchSwapQuote(opts: {
  token: string;
  side: "buy" | "sell";
  amountUsd?: number;
  amountIn?: bigint;
  signal?: AbortSignal;
}): Promise<QuoteResult> {
  const params = new URLSearchParams({
    token: opts.token,
    side: opts.side,
  });
  if (opts.amountIn != null && opts.amountIn > 0n) {
    params.set("amountIn", opts.amountIn.toString());
  }
  if (opts.amountUsd != null && Number.isFinite(opts.amountUsd) && opts.amountUsd > 0) {
    params.set("amountUsd", String(opts.amountUsd));
  }
  const res = await fetch(`/api/quote?${params}`, {signal: opts.signal});
  const body: unknown = await res.json().catch(() => null);
  return parseSwapQuote(body);
}
