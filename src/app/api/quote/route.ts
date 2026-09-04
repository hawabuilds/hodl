import {isAddress, normalizeAddress} from "@/lib/address";
import {json} from "@/lib/server/http";
import {QUOTE_USDG} from "@/lib/contracts";
import {humanToRaw, usdgRawFromUsd} from "@/lib/quoteAmounts";
import {venueTicketCopy} from "@/lib/venueQuote";
import {poolFor} from "@/lib/server/live/market";
import {resolveVenue} from "@/lib/server/live/venueResolve";

export const dynamic = "force-dynamic";

/**
 * Per-size venue quote. Does not persist a venue on the token.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawToken = url.searchParams.get("token") ?? "";
  const token = isAddress(rawToken) ? normalizeAddress(rawToken) : "";
  const side = url.searchParams.get("side") === "sell" ? "sell" : "buy";
  if (!token) {
    return json({error: "token required"}, 400);
  }

  const pool = await poolFor("token", token);
  const v4PoolId =
    pool?.pool && /^0x[0-9a-f]{64}$/.test(pool.pool) ? pool.pool : null;

  const amountUsd = Number(url.searchParams.get("amountUsd") ?? "");
  const amountInParam = Number(url.searchParams.get("amountIn") ?? "");
  const amountIn =
    Number.isFinite(amountUsd) && amountUsd > 0
      ? usdgRawFromUsd(amountUsd)
      : Number.isFinite(amountInParam) && amountInParam > 0
        ? humanToRaw(amountInParam, 18)
        : 10n ** 16n;

  const sized = await resolveVenue({token, side, amountIn, v4PoolId});
  if (!sized) return json({venue: null});

  // If we sized as USDG but the winning quote is WETH, requote in WETH units.
  if (
    Number.isFinite(amountUsd) &&
    amountUsd > 0 &&
    sized.quoteToken !== QUOTE_USDG
  ) {
    const retry = await resolveVenue({
      token,
      side,
      amountIn: 10n ** 16n,
      v4PoolId,
    });
    if (retry) {
      const copy = venueTicketCopy(retry);
      return json({
        venue: retry.venue,
        venueLabel: copy.venue,
        creatorTax: copy.creatorTax,
        creatorTaxBps: retry.creatorTaxBps,
        amountOut: retry.amountOut.toString(),
        netOut: retry.netOut.toString(),
        quoteToken: retry.quoteToken,
        label: retry.label,
      });
    }
  }

  const copy = venueTicketCopy(sized);
  return json({
    venue: sized.venue,
    venueLabel: copy.venue,
    creatorTax: copy.creatorTax,
    creatorTaxBps: sized.creatorTaxBps,
    amountOut: sized.amountOut.toString(),
    netOut: sized.netOut.toString(),
    quoteToken: sized.quoteToken,
    label: sized.label,
  });
}
