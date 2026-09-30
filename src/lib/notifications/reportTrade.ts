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

/** After a confirmed receipt or a failed submit that charged nothing. */
export async function reportTradeNotify(
  getToken: () => Promise<string | null>,
  event: TradeNotifyEvent,
): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await fetch("/api/me/trades/notify", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

export function isUserDeclinedTrade(reason: string): boolean {
  return /user rejected|user denied|rejected the request|denied transaction|declined the signature|wallet declined/i.test(
    reason,
  );
}
