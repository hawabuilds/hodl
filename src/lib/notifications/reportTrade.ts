export type TradeNotifyEvent =
  | {
      status: "filled";
      side: "buy" | "sell";
      kind: "token" | "rwa";
      assetId: string;
      ticker: string;
      tokenAmount: number;
      quoteAmount: number;
      quoteSymbol: string;
      /** The swap's hash, so the server can check the fill on chain. */
      txHash?: string;
    }
  | {
      status: "failed";
      kind: "token" | "rwa";
      assetId: string;
      ticker: string;
      reason: string;
    };

/** Reasons a save can succeed on a later try (the node had not caught up, a blip). */
const RETRYABLE = new Set(["error", "reverted", "asset did not move"]);
const RETRY_DELAYS_MS = [4_000, 12_000];

/**
 * After a confirmed receipt or a failed submit that charged nothing. A fill
 * is also saved to trade history; if that save does not go through for a
 * reason that may pass, it is retried (save only — nobody is alerted twice).
 */
export async function reportTradeNotify(
  getToken: () => Promise<string | null>,
  event: TradeNotifyEvent,
): Promise<void> {
  const send = async (extra: Record<string, unknown> = {}) => {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch("/api/me/trades/notify", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({...event, ...extra}),
    }).catch(() => null);
    if (!res?.ok) return {recorded: false, reason: "error"};
    return (await res.json().catch(() => null)) as {recorded?: boolean; reason?: string | null} | null;
  };

  let result = await send();
  if (event.status !== "filled" || !event.txHash) return;
  for (const delay of RETRY_DELAYS_MS) {
    if (!result || result.recorded || !RETRYABLE.has(result.reason ?? "")) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await send({recordOnly: true});
  }
}

export function isUserDeclinedTrade(reason: string): boolean {
  return /user rejected|user denied|rejected the request|denied transaction|declined the signature|wallet declined/i.test(
    reason,
  );
}
