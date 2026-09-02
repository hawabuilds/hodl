import {createPublicClient, http, parseAbi, type PublicClient} from "viem";
import {robinhoodMainnet} from "@/config/chain";
import {cached} from "./cache";

/**
 * Direct chain reads.
 *
 * Only `eth_call` and balance lookups live here. `eth_getLogs` is deliberately
 * absent: on the current Alchemy plan it is capped at a ten-block range, and
 * with a head above fifty million blocks a history scan would be millions of
 * requests. The swap indexer that charts and the trade tape need is gated on
 * that plan, not on this file.
 */

let client: PublicClient | null = null;

export function rpc(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: robinhoodMainnet,
      transport: http(process.env.ALCHEMY_RPC_URL, {
        batch: true,
        retryCount: 2,
      }),
      batch: {multicall: {wait: 20}},
    }) as PublicClient;
  }
  return client;
}

export const erc20Abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** ERC-8056, the extension every stock token carries. */
export const scaledAbi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
]);

const SUPPLY_TTL_MS = 10 * 60_000;

/**
 * On-chain supply for a set of tokens, as whole units.
 *
 * Multicalled, so two hundred stock tokens cost one round trip rather than two
 * hundred. Cached for ten minutes: supply moves only when an Authorized
 * Participant mints or burns, which is not a per-request event.
 */
export async function totalSupplies(
  tokens: {address: string; decimals: number}[],
): Promise<Map<string, number>> {
  const key = `supply:${tokens.length}`;

  return cached(key, SUPPLY_TTL_MS, async () => {
    const out = new Map<string, number>();
    if (tokens.length === 0) return out;

    const results = await rpc().multicall({
      contracts: tokens.map((token) => ({
        address: token.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "totalSupply" as const,
      })),
      allowFailure: true,
    });

    results.forEach((result, i) => {
      if (result.status !== "success") return;
      const raw = result.result as bigint;
      const scale = 10 ** tokens[i].decimals;
      const supply = Number(raw) / scale;
      if (Number.isFinite(supply) && supply > 0) {
        out.set(tokens[i].address.toLowerCase(), supply);
      }
    });

    return out;
  });
}

/**
 * Token balances for a wallet, as whole units.
 *
 * `alchemy_getTokenBalances` in one call rather than a `balanceOf` per token —
 * it works on every plan and is the cheaper path by a wide margin.
 */
export async function balancesFor(
  wallet: string,
  tokens: {address: string; decimals: number}[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!process.env.ALCHEMY_RPC_URL || tokens.length === 0) return out;

  const res = await fetch(process.env.ALCHEMY_RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenBalances",
      params: [wallet, tokens.map((t) => t.address)],
    }),
  });

  if (!res.ok) throw new Error(`getTokenBalances ${res.status}`);
  const body = (await res.json()) as {
    result?: {tokenBalances?: {contractAddress: string; tokenBalance: string | null}[]};
    error?: {message: string};
  };
  if (body.error) throw new Error(body.error.message);

  const decimalsFor = new Map(
    tokens.map((t) => [t.address.toLowerCase(), t.decimals]),
  );

  for (const entry of body.result?.tokenBalances ?? []) {
    const address = entry.contractAddress.toLowerCase();
    if (!entry.tokenBalance || entry.tokenBalance === "0x") continue;

    const raw = BigInt(entry.tokenBalance);
    if (raw === 0n) continue;

    const decimals = decimalsFor.get(address) ?? 18;
    const amount = Number(raw) / 10 ** decimals;
    if (Number.isFinite(amount) && amount > 0) out.set(address, amount);
  }

  return out;
}

/** Native ETH balance, in whole ETH. */
export async function nativeBalance(wallet: string): Promise<number> {
  const wei = await rpc().getBalance({address: wallet as `0x${string}`});
  return Number(wei) / 1e18;
}
