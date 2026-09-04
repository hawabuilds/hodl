import type {Holding} from "@/lib/types";
import {normalizeAddress, isAddress} from "@/lib/address";
import {feedImageUrl} from "@/lib/tokenImage";
import {RH_MAINNET_ID} from "@/config/chain";
import {hasDatabase} from "../db";
import {nativeBalance, walletSnapshot} from "./chain";
import {cachedQuotes, RWA_BY_ADDRESS, RWA_REGISTRY} from "./robinhood";
import {getTokenRows, statsFor, type TokenRow} from "./universeStore";

export interface PortfolioTiming {
  discoverMs: number;
  rpcMs: number;
  supabaseMs: number;
  totalMs: number;
  candidates: number;
  rpcCalls: number;
}

export interface HoldingsResult {
  holdings: Holding[];
  ethBalance: number;
  degraded: boolean;
  wallets: string[];
  chainId: number;
  timing: PortfolioTiming;
}

function walletsOf(raw: string[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const address = normalizeAddress(value);
    if (isAddress(address) && !out.includes(address)) out.push(address);
  }
  return out;
}

/** Union of address lists, lowercase, first-seen order. */
export function mergeCandidates(...groups: Iterable<string>[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      const address = normalizeAddress(value);
      if (!isAddress(address) || seen.has(address)) continue;
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

interface TransferRow {
  rawContract?: {address?: string};
  rawContractAddress?: string;
}

async function alchemyTransfers(wallet: string, side: "from" | "to"): Promise<string[]> {
  const url = process.env.ALCHEMY_RPC_URL;
  if (!url) return [];
  const filter: Record<string, unknown> = {
    category: ["erc20"],
    excludeZeroValue: true,
    maxCount: "0x3e8",
    withMetadata: false,
  };
  if (side === "from") filter.fromAddress = wallet;
  else filter.toAddress = wallet;

  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [filter],
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    result?: {transfers?: TransferRow[]};
    error?: {message: string};
  };
  if (body.error) return [];
  const out: string[] = [];
  for (const row of body.result?.transfers ?? []) {
    const address = row.rawContract?.address ?? row.rawContractAddress;
    if (address) out.push(address);
  }
  return out;
}

async function touchedTokens(wallet: string): Promise<string[]> {
  const [sent, received] = await Promise.all([
    alchemyTransfers(wallet, "from"),
    alchemyTransfers(wallet, "to"),
  ]);
  return mergeCandidates(sent, received);
}

function rwaAddresses(): string[] {
  return RWA_REGISTRY.map((entry) => normalizeAddress(entry.address));
}

/**
 * What the wallets actually hold.
 *
 * Candidates are tokens this wallet has touched, the RWA registry, and
 * addresses the client already knows it holds. Never the whole universe —
 * and never filtered on eligible / is_tradeable / status.
 */
export async function holdingsFor(
  walletOrWallets: string | string[],
  known: string[] = [],
): Promise<HoldingsResult> {
  const started = Date.now();
  const emptyTiming = (): PortfolioTiming => ({
    discoverMs: 0,
    rpcMs: 0,
    supabaseMs: 0,
    totalMs: Date.now() - started,
    candidates: 0,
    rpcCalls: 0,
  });

  const wallets = walletsOf(
    Array.isArray(walletOrWallets) ? walletOrWallets : [walletOrWallets],
  );
  if (wallets.length === 0) {
    return {
      holdings: [],
      ethBalance: 0,
      degraded: false,
      wallets: [],
      chainId: RH_MAINNET_ID,
      timing: emptyTiming(),
    };
  }

  const discoverStarted = Date.now();
  const touched = await Promise.all(wallets.map((wallet) => touchedTokens(wallet)));
  const candidates = mergeCandidates(rwaAddresses(), known, ...touched);
  const discoverMs = Date.now() - discoverStarted;

  const wanted = candidates.map((address) => ({
    address,
    decimals: RWA_BY_ADDRESS.get(address)?.decimals ?? 18,
  }));

  const rpcStarted = Date.now();
  const merged = new Map<string, number>();
  let eth = 0;
  let rpcCalls = 0;
  let degraded = false;

  try {
    const reads = await Promise.all(
      wallets.map((wallet) => walletSnapshot(wallet, wanted)),
    );
    for (const read of reads) {
      eth += read.eth;
      rpcCalls += read.rpcCalls;
      for (const [address, amount] of read.amounts) {
        merged.set(address, (merged.get(address) ?? 0) + amount);
      }
    }
  } catch (error) {
    console.error("balance read failed", error);
    degraded = true;
  }
  const rpcMs = Date.now() - rpcStarted;

  const held = [...merged.entries()].filter(([, amount]) => amount > 0);
  const heldAddresses = held.map(([address]) => address);

  const enrichStarted = Date.now();
  const [rows, stats, quotes] = await Promise.all([
    hasDatabase && heldAddresses.length > 0
      ? getTokenRows(heldAddresses).catch(() => [] as TokenRow[])
      : Promise.resolve([] as TokenRow[]),
    heldAddresses.length > 0
      ? statsFor(heldAddresses).catch(() => new Map())
      : Promise.resolve(new Map()),
    Promise.resolve(cachedQuotes()),
  ]);
  const byRow = new Map(rows.map((row) => [normalizeAddress(row.address), row]));
  const supabaseMs = Date.now() - enrichStarted;

  const holdings: Holding[] = [];
  for (const [address, amount] of held) {
    const row = byRow.get(address);
    const rwa = RWA_BY_ADDRESS.get(address);
    const stat = stats.get(address);
    if (rwa) {
      const priceUsd = quotes.get(rwa.ticker)?.priceUsd ?? 0;
      holdings.push({
        kind: "rwa",
        assetId: rwa.ticker.toLowerCase(),
        symbol: rwa.ticker,
        name: rwa.name,
        logoUrl: rwa.logoUrl,
        amount,
        valueUsd: priceUsd > 0 ? amount * priceUsd : 0,
        changePct: 0,
        costUsd: null,
      });
      continue;
    }
    const priceUsd =
      stat?.last_price != null && Number(stat.last_price) > 0
        ? Number(stat.last_price)
        : null;
    holdings.push({
      kind: "token",
      assetId: address,
      symbol: row?.symbol ?? "???",
      name: row?.name ?? row?.symbol ?? "Unknown",
      logoUrl: row ? feedImageUrl(row) : null,
      amount,
      valueUsd: priceUsd != null ? amount * priceUsd : 0,
      changePct: Number(stat?.price_change_24h ?? 0),
      costUsd: null,
    });
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return {
    holdings,
    ethBalance: eth,
    degraded,
    wallets,
    chainId: RH_MAINNET_ID,
    timing: {
      discoverMs,
      rpcMs,
      supabaseMs,
      totalMs: Date.now() - started,
      candidates: candidates.length,
      rpcCalls,
    },
  };
}

export async function nativeOnly(
  walletOrWallets: string | string[],
): Promise<{ethBalance: number; wallets: string[]; chainId: number; rpcCalls: number; totalMs: number}> {
  const started = Date.now();
  const wallets = walletsOf(
    Array.isArray(walletOrWallets) ? walletOrWallets : [walletOrWallets],
  );
  if (wallets.length === 0) {
    return {ethBalance: 0, wallets: [], chainId: RH_MAINNET_ID, rpcCalls: 0, totalMs: 0};
  }
  const reads = await Promise.all(wallets.map((wallet) => nativeBalance(wallet).catch(() => 0)));
  return {
    ethBalance: reads.reduce((sum, value) => sum + value, 0),
    wallets,
    chainId: RH_MAINNET_ID,
    rpcCalls: wallets.length,
    totalMs: Date.now() - started,
  };
}

