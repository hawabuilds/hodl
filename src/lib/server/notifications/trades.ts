import {assetPath} from "@/lib/routes";
import {tradeFailedCopy, tradeFilledCopy} from "@/lib/notifications/copy";
import {enqueueNotification} from "./dispatch";

export async function notifyTradeFilled(input: {
  userId: string;
  side: "buy" | "sell";
  kind: "token" | "rwa";
  assetId: string;
  ticker: string;
  tokenAmount: number;
  quoteAmount: number;
  quoteSymbol: string;
}): Promise<void> {
  const copy = tradeFilledCopy(input);
  await enqueueNotification({
    userId: input.userId,
    channel: "holdings",
    kind: "trade",
    title: copy.title,
    body: copy.body,
    url: assetPath(input.kind, input.assetId),
    digest: {type: "trade", ticker: input.ticker, n: 1},
    dedupeKey: `trade:${input.userId}:${input.kind}:${input.assetId}:${input.side}:${Math.round(input.tokenAmount)}:${Math.round(input.quoteAmount * 1e6)}`,
  });
}

export async function notifyTradeFailed(input: {
  userId: string;
  kind: "token" | "rwa";
  assetId: string;
  ticker: string;
  reason: string;
}): Promise<void> {
  const copy = tradeFailedCopy(input.reason);
  await enqueueNotification({
    userId: input.userId,
    channel: "holdings",
    kind: "trade_failed",
    title: copy.title,
    body: copy.body,
    url: assetPath(input.kind, input.assetId),
    digest: {type: "trade", ticker: input.ticker, n: 1},
    dedupeKey: `trade-fail:${input.userId}:${input.kind}:${input.assetId}:${input.reason.slice(0, 40)}`,
  });
}
