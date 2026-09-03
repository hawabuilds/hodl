import type {Trade} from "./types";

function logIndexOf(trade: Trade): number {
  const part = trade.id.split("-").pop();
  if (!part) return 0;
  const n = parseInt(part, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Newest fill first; within one block, higher log index first. */
export function compareTradesNewestFirst(a: Trade, b: Trade): number {
  const atDiff = Date.parse(b.at) - Date.parse(a.at);
  if (atDiff !== 0) return atDiff;
  return logIndexOf(b) - logIndexOf(a);
}
