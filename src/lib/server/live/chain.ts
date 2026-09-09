import {createPublicClient, parseAbi, type PublicClient} from "viem";
import {robinhoodMainnet} from "@/config/chain";
import {cached} from "./cache";
import {createReadTransport} from "./rpcProviders";
import {recordPayload, recordRetry} from "./rpcMeter";

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
      // ALCHEMY_RPC_URL → CHAINSTACK_RPC_URL → public Robinhood RPC.
      transport: createReadTransport(async (request) => {
        try {
          recordPayload(await request.clone().json());
        } catch {
          // Counting must never be able to break a request.
        }
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
  const key = `supply:${[...tokens.map((t) => t.address.toLowerCase())].sort().join(",")}`;

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

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const multicall3Abi = parseAbi([
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);

/**
 * Native ETH plus every ERC-20 balance, one Multicall3 `eth_call`.
 *
 * Do not loop `balanceOf`. The candidate list must already be small — tokens
 * this wallet has touched, plus the RWA registry — not the universe.
 */
export async function walletSnapshot(
  wallet: string,
  tokens: {address: string; decimals: number}[],
): Promise<{eth: number; amounts: Map<string, number>; rpcCalls: number}> {
  const owner = wallet as `0x${string}`;
  const contracts = [
    {
      address: MULTICALL3,
      abi: multicall3Abi,
      functionName: "getEthBalance" as const,
      args: [owner] as const,
    },
    ...tokens.map((token) => ({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [owner] as const,
    })),
  ];

  const results = await rpc().multicall({contracts, allowFailure: true});
  const amounts = new Map<string, number>();
  let eth = 0;

  const native = results[0];
  if (native?.status === "success") {
    eth = Number(native.result) / 1e18;
    if (!Number.isFinite(eth)) eth = 0;
  }

  for (let i = 0; i < tokens.length; i++) {
    const result = results[i + 1];
    if (result?.status !== "success") continue;
    const raw = result.result as bigint;
    if (raw === 0n) continue;
    const amount = Number(raw) / 10 ** tokens[i].decimals;
    if (Number.isFinite(amount) && amount > 0) {
      amounts.set(tokens[i].address.toLowerCase(), amount);
    }
  }

  return {eth, amounts, rpcCalls: 1};
}

/**
 * How many contracts go into one multicall.
 *
 * The feed asks about every token at once, which is around a thousand. Sent as
 * a single aggregate that call is large enough to fail outright on a serverless
 * function — and it failed silently, so production served a feed with no
 * launchpads, no graduation and no reward routing while the DexScreener fields
 * beside them looked fine.
 */
const BATCH = 120;

/**
 * Batches in flight at once.
 *
 * The whole set used to go out together, which is a burst of thirty large
 * `eth_call`s and reliably drew rate limiting. Three at a time is slower on a
 * cold cache and gives the same answer every time, which matters more.
 */
const LANES = 3;

/**
 * A multicall split into batches, with failures surfaced rather than swallowed.
 *
 * Returns one entry per input, in order, so callers can index against their own
 * array. A batch that fails contributes failures rather than shortening the
 * result, which would silently misalign everything after it — and marks them
 * `unreachable`, so a caller can tell "it said no" from "it never answered".
 */
export async function multicallChunked<T>(
  contracts: readonly unknown[],
  label: string,
): Promise<
  {status: "success" | "failure"; result?: T; unreachable?: boolean}[]
> {
  if (contracts.length === 0) return [];

  const batches: unknown[][] = [];
  for (let i = 0; i < contracts.length; i += BATCH) {
    batches.push(contracts.slice(i, i + BATCH) as unknown[]);
  }

  const results: {status: "success" | "failure"; result?: T; unreachable?: boolean}[][] =
    new Array(batches.length);
  let next = 0;

  async function worker() {
    while (next < batches.length) {
      const index = next++;
      results[index] = await attempt(batches[index], label);
    }
  }

  await Promise.all(
    Array.from({length: Math.min(LANES, batches.length)}, worker),
  );

  return results.flat();
}

/**
 * One batch, with a retry.
 *
 * The provider rate-limits on compute rather than requests, so a burst of
 * batches gets some of them rejected — and a rejected batch used to read as a
 * definitive answer for every token in it. That is what made the feed's own
 * figures swing between runs: a hundred and fifty-five graduated tokens on one
 * build, sixty-seven on the next, from identical data.
 */
async function attempt<T>(
  batch: unknown[],
  label: string,
  tries = 3,
): Promise<{status: "success" | "failure"; result?: T; unreachable?: boolean}[]> {
  for (let attemptNo = 0; attemptNo < tries; attemptNo++) {
    try {
      return (await rpc().multicall({
        contracts: batch as never,
        allowFailure: true,
      })) as {status: "success" | "failure"; result?: T}[];
    } catch (error) {
      if (attemptNo === tries - 1) {
        // Flagged, because a batch that never ran is not the same as a call
        // that reverted. A revert is the negative answer and worth caching; an
        // unreachable batch is no answer at all, and caching it as "no" is how
        // production ended up serving empty fields for half an hour.
        console.error(`${label}: multicall batch failed`, error);
        return batch.map(() => ({
          status: "failure" as const,
          unreachable: true,
        }));
      }
      recordRetry();
      // Backs off rather than repeating immediately: the limit is on compute
      // per unit time, so spacing the retries is what lets one succeed.
      await new Promise((resolve) =>
        setTimeout(resolve, 400 * 2 ** attemptNo),
      );
    }
  }

  return batch.map(() => ({status: "failure" as const, unreachable: true}));
}
