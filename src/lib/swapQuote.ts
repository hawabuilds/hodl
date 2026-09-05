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
  quoteToken: `0x${string}`;
  tokenDecimals: number;
  quoteDecimals: number;
  outDecimals: number;
  zeroForOne: boolean;
  quoteIsNative: boolean;
  quoteIsWeth: boolean;
  poolKey: V4PoolKey | null;
  v3Fee: number | null;
  v3Pool: `0x${string}` | null;
}

export type QuoteResult =
  | {ok: true; quote: SwapQuote}
  | {ok: false; venue: null; error?: string};

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
      quoteToken: quoteToken as `0x${string}`,
      tokenDecimals: Number(row.tokenDecimals ?? 18),
      quoteDecimals: Number(row.quoteDecimals ?? 18),
      outDecimals: Number(row.outDecimals ?? 18),
      zeroForOne: Boolean(row.zeroForOne),
      quoteIsNative: Boolean(row.quoteIsNative),
      quoteIsWeth: Boolean(row.quoteIsWeth),
      poolKey,
      v3Fee: Number.isFinite(v3Fee) ? v3Fee : null,
      v3Pool: typeof row.v3Pool === "string" ? (row.v3Pool as `0x${string}`) : null,
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
