import {PrivyClient} from "@privy-io/server-auth";

import {QUOTE_USDG, QUOTE_WETH} from "@/lib/contracts";
import {db, hasDatabase} from "@/lib/server/db";
import {rpc as chain} from "@/lib/server/live/chain";
import {ethUsd} from "@/lib/server/live/onchainPrice";
import {RWA_BY_TICKER} from "@/lib/server/live/robinhood";
import {decimalsOf} from "@/lib/server/live/swaps";

/**
 * Trades made through HODL, recorded for the Following feed.
 *
 * The ticket reports a fill after its receipt confirms, but a report is a
 * claim. Nothing is written until the chain agrees: the transaction succeeded,
 * it was sent by a wallet linked to the caller's Privy account, and it moved
 * the asset into or out of that wallet. Side and size come from the receipt's
 * logs, not from the report, so the feed shows what happened on chain.
 */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** WETH's Withdrawal(address,uint256): a sell paid out in native ETH. */
const WITHDRAWAL_TOPIC = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

export interface ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface FillLegs {
  side: "buy" | "sell";
  /** Raw units of the asset that moved. */
  tokenRaw: bigint;
  /** Raw USDG (6 decimals) paid or received. */
  usdgRaw: bigint;
  /** Raw wei of ETH or WETH paid or received. */
  ethRaw: bigint;
}

function topicAddress(topic: string | undefined): string {
  return topic ? `0x${topic.slice(-40)}`.toLowerCase() : "";
}

function amount(data: string): bigint {
  try {
    return data && data !== "0x" ? BigInt(data.slice(0, 66)) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * The asset and dollar legs of a swap, read from its receipt.
 *
 * Returns null when the asset did not move for this wallet, or moved both ways
 * in equal measure — that is not a trade of it.
 */
export function readFill(input: {
  logs: readonly ReceiptLog[];
  wallet: string;
  asset: string;
  /** Native ETH the wallet sent with the transaction. */
  value: bigint;
}): FillLegs | null {
  const wallet = input.wallet.toLowerCase();
  const asset = input.asset.toLowerCase();
  const usdg = QUOTE_USDG.toLowerCase();
  const weth = QUOTE_WETH.toLowerCase();

  let tokenIn = 0n;
  let tokenOut = 0n;
  const quote = {usdgIn: 0n, usdgOut: 0n, wethIn: 0n, wethOut: 0n, unwrapped: 0n};

  for (const log of input.logs) {
    const address = log.address.toLowerCase();
    const topic = log.topics[0]?.toLowerCase();
    if (topic === WITHDRAWAL_TOPIC && address === weth) {
      quote.unwrapped += amount(log.data);
      continue;
    }
    if (topic !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    const value = amount(log.data);
    if (address === asset) {
      if (to === wallet) tokenIn += value;
      if (from === wallet) tokenOut += value;
    } else if (address === usdg) {
      if (to === wallet) quote.usdgIn += value;
      if (from === wallet) quote.usdgOut += value;
    } else if (address === weth) {
      if (to === wallet) quote.wethIn += value;
      if (from === wallet) quote.wethOut += value;
    }
  }

  if (tokenIn === tokenOut) return null;
  if (tokenIn > tokenOut) {
    return {
      side: "buy",
      tokenRaw: tokenIn - tokenOut,
      usdgRaw: quote.usdgOut,
      ethRaw: quote.wethOut + input.value,
    };
  }
  return {
    side: "sell",
    tokenRaw: tokenOut - tokenIn,
    usdgRaw: quote.usdgIn,
    ethRaw: quote.wethIn + quote.unwrapped,
  };
}

/** Dollars from the quote legs; null when a leg cannot be priced. */
export function fillUsd(legs: FillLegs, ethPrice: number | null): number | null {
  const usdg = Number(legs.usdgRaw) / 1e6;
  const eth = Number(legs.ethRaw) / 1e18;
  if (eth > 0 && !(ethPrice && ethPrice > 0)) return null;
  const total = usdg + (eth > 0 ? eth * (ethPrice ?? 0) : 0);
  return total > 0 ? total : null;
}

// ── Linked wallets ─────────────────────────────────────────────────────

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";
let privy: PrivyClient | null = null;
const walletCache = new Map<string, {at: number; wallets: string[]}>();
const WALLET_TTL_MS = 10 * 60_000;

/**
 * Every wallet linked to a Privy account — the embedded one and any the user
 * connected. This is the link the brief asks for, and it cannot be set from
 * the browser the way `users.wallet` can.
 */
export async function linkedWallets(userId: string): Promise<string[]> {
  const hit = walletCache.get(userId);
  if (hit && Date.now() - hit.at < WALLET_TTL_MS) return hit.wallets;
  if (!appId || !appSecret) return [];
  privy ??= new PrivyClient(appId, appSecret);
  const user = await privy.getUser(userId);
  const wallets = user.linkedAccounts
    .filter((account) => account.type === "wallet" || account.type === "smart_wallet")
    .map((account) => String((account as {address?: string}).address ?? "").toLowerCase())
    .filter((address) => /^0x[0-9a-f]{40}$/.test(address));
  walletCache.set(userId, {at: Date.now(), wallets});
  return wallets;
}

// ── Recording ──────────────────────────────────────────────────────────

export type RecordResult =
  | {recorded: true}
  | {recorded: false; reason: string};

function assetAddress(kind: "token" | "rwa", assetId: string): string | null {
  if (kind === "token") return /^0x[0-9a-fA-F]{40}$/.test(assetId) ? assetId.toLowerCase() : null;
  return RWA_BY_TICKER.get(assetId.toUpperCase())?.address.toLowerCase() ?? null;
}

export async function recordHodlTrade(input: {
  userId: string;
  txHash: string;
  kind: "token" | "rwa";
  assetId: string;
  symbol: string;
}): Promise<RecordResult> {
  if (!hasDatabase) return {recorded: false, reason: "no database"};
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) return {recorded: false, reason: "not a tx hash"};
  const asset = assetAddress(input.kind, input.assetId);
  if (!asset) return {recorded: false, reason: "unknown asset"};

  const hash = input.txHash.toLowerCase() as `0x${string}`;
  const client = chain();
  // The ticket waited for its own node; ours may be a block behind.
  const receipt = await client.waitForTransactionReceipt({hash, timeout: 15_000});
  if (receipt.status !== "success") return {recorded: false, reason: "reverted"};

  const sender = receipt.from.toLowerCase();
  const wallets = await linkedWallets(input.userId);
  if (!wallets.includes(sender)) return {recorded: false, reason: "sender not linked"};

  const tx = await client.getTransaction({hash});
  const legs = readFill({logs: receipt.logs, wallet: sender, asset, value: tx.value});
  if (!legs) return {recorded: false, reason: "asset did not move"};

  const decimals = await decimalsOf(asset);
  if (decimals == null) return {recorded: false, reason: "unknown decimals"};
  const block = await client.getBlock({blockNumber: receipt.blockNumber});

  const {error} = await db()
    .from("hodl_trades")
    .upsert(
      {
        tx_hash: hash,
        user_id: input.userId,
        wallet: sender,
        side: legs.side,
        kind: input.kind,
        asset_id: input.kind === "token" ? asset : input.assetId.toUpperCase(),
        symbol: input.symbol,
        token_amount: Number(legs.tokenRaw) / 10 ** decimals,
        usd: fillUsd(legs, legs.ethRaw > 0n ? await ethUsd() : null),
        traded_at: new Date(Number(block.timestamp) * 1000).toISOString(),
      },
      {onConflict: "tx_hash", ignoreDuplicates: true},
    );
  if (error) throw error;
  return {recorded: true};
}
