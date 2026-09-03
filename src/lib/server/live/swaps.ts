import {
  decodeAbiParameters,
  parseAbiParameters,
  toEventSelector,
} from "viem";
import type {Trade} from "@/lib/types";
import {compareTradesNewestFirst} from "@/lib/tradeOrder";
import {cached} from "./cache";
import {QUOTE_ASSETS} from "./dexscreener";

/**
 * The last few seconds of fills, read straight off the chain.
 *
 * The indexer the tape is otherwise built from is roughly eleven seconds behind
 * the block — measured over two hundred and thirty fills, median 11s, worst
 * 23s. That is the floor however fast the app polls it, and it is what made new
 * buys and sells feel late.
 *
 * Reading the pool's own `Swap` logs closes almost all of it: the same fills
 * are available about half a second after the block. So the tape is assembled
 * from both — this for the head, the indexer for depth and history — which also
 * means a failure here costs freshness rather than the whole panel.
 *
 * Sides were checked against the indexer before this was trusted: seven of
 * seven on v3, fifty of fifty on v4. The two versions sign their amounts
 * oppositely, which is the one detail here worth getting right.
 */

/** Uniswap v3-style pools, which emit from the pool contract itself. */
const V3_SWAP = toEventSelector(
  "Swap(address,address,int256,int256,uint160,uint128,int24)",
);

/** Uniswap v4, where every pool emits from the singleton, keyed by pool id. */
const V4_SWAP = toEventSelector(
  "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
);

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

/**
 * How far back to look.
 *
 * The RPC plan caps `eth_getLogs` at ten blocks. At roughly a second a block
 * that is about ten seconds of history, which comfortably covers the gap
 * between polls — the indexed tape supplies everything older.
 */
const BLOCKS = 9n;

/** Each tape poll reads the chain fresh — caching here made fills feel stuck. */
const TTL_MS = 0;

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = process.env.ALCHEMY_RPC_URL;
  if (!url) throw new Error("no rpc configured");

  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
    signal: AbortSignal.timeout(6000),
  });

  const body = (await res.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

const isPoolId = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

/**
 * Recent fills for one pool.
 *
 * `token` is the asset whose page this is; amounts and sides are expressed from
 * its point of view, so a pool that quotes the other way round still reads
 * correctly.
 */
export async function recentSwaps(
  pool: string,
  token: string,
  quote: string,
  priceUsd: number,
  /** USD price of the quote asset — USDG is 1, RWAs from Robinhood mid. */
  quotePriceUsd: number | null = null,
): Promise<Trade[]> {
  const ours = token.toLowerCase();

  const load = async (): Promise<Trade[]> => {
    const other = quote.toLowerCase();
    const quoteSymbol = QUOTE_ASSETS.get(other);

    // Uniswap orders a pool's currencies by address, so which of the two
    // amounts is ours follows from comparing them — no need to ask the pool.
    const oursIsToken0 = ours < other;

    const head = BigInt(await rpc<string>("eth_blockNumber", []));
    const from = "0x" + (head - BLOCKS).toString(16);
    const to = "0x" + head.toString(16);

    const v4 = isPoolId(pool);

    const filter = v4
      ? {fromBlock: from, toBlock: to, address: POOL_MANAGER, topics: [V4_SWAP, pool]}
      : {fromBlock: from, toBlock: to, address: pool, topics: [V3_SWAP]};

    const logs = await rpc<RawLog[]>("eth_getLogs", [filter]);
    if (logs.length === 0) return [];

    // One lookup per block rather than per fill: a busy pool puts a dozen
    // swaps in the same block.
    const blocks = [...new Set(logs.map((log) => log.blockNumber))];
    const times = new Map<string, number>();

    await Promise.all(
      blocks.map(async (blockNumber) => {
        try {
          const block = await rpc<{timestamp: string}>(
            "eth_getBlockByNumber",
            [blockNumber, false],
          );
          times.set(blockNumber, parseInt(block.timestamp, 16) * 1000);
        } catch {
          // A block we cannot time is a fill we cannot place.
        }
      }),
    );

    const shape = v4
      ? parseAbiParameters("int128,int128,uint160,uint128,int24,uint24")
      : parseAbiParameters("int256,int256,uint160,uint128,int24");

    const trades: Trade[] = [];

    for (const log of logs) {
      const at = times.get(log.blockNumber);
      if (!at) continue;

      let amount0: bigint;
      let amount1: bigint;
      try {
        const decoded = decodeAbiParameters(shape, log.data as `0x${string}`);
        amount0 = decoded[0] as bigint;
        amount1 = decoded[1] as bigint;
      } catch {
        continue;
      }

      const delta = oursIsToken0 ? amount0 : amount1;
      if (delta === 0n) continue;

      // The two versions sign this oppositely, and getting it backwards prints
      // every buy as a sell.
      //
      // v3 reports the pool's balance change, so our token going negative means
      // the pool paid it out — someone bought. v4 reports the swapper's, so the
      // same trade shows positive.
      //
      // Confirmed on fifty v4 fills matched to the indexer by transaction *and
      // log index*, with nothing unmatched. An earlier attempt matched on the
      // transaction alone and read as a coin flip, because pools here routinely
      // put ten swaps in one transaction — so the hash identified a batch and
      // the comparison was picking an arbitrary member of it.
      const buy = v4 ? delta > 0n : delta < 0n;
      const amount = Number(delta < 0n ? -delta : delta) / 1e18;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const quoteDelta = oursIsToken0 ? amount1 : amount0;
      const quoteAmount =
        Number(quoteDelta < 0n ? -quoteDelta : quoteDelta) / 1e18;

      // Size the fill from the quote leg when we know that asset's USD price.
      // DexScreener and the indexer both do this; token spot × amount is wrong
      // on RWA-paired pools (e.g. OUROBOROS/CRCL).
      let executionPrice = priceUsd;
      let amountUsd = amount * priceUsd;
      const quoteAbs =
        Number.isFinite(quoteAmount) && quoteAmount > 0 ? quoteAmount : 0;

      if (quoteSymbol === "USDG" && quoteAbs > 0) {
        amountUsd = quoteAbs;
        executionPrice = quoteAbs / amount;
      } else if (quotePriceUsd != null && quotePriceUsd > 0 && quoteAbs > 0) {
        amountUsd = quoteAbs * quotePriceUsd;
        executionPrice = amountUsd / amount;
      }

      trades.push({
        id: `${log.transactionHash}-${parseInt(log.logIndex, 16)}`,
        side: buy ? "buy" : "sell",
        amount,
        amountUsd,
        priceUsd: executionPrice,
        // The second indexed argument is the recipient on a v3 pool and the
        // swap's sender on v4; either is the closest thing to a counterparty
        // without paying for a transaction lookup per fill.
        maker: log.topics[2] ? "0x" + log.topics[2].slice(26) : "0x",
        txHash: log.transactionHash,
        makerHandle: null,
        at: new Date(at).toISOString(),
      });
    }

    return trades.sort(compareTradesNewestFirst);
  };

  if (TTL_MS <= 0) {
    try {
      return await load();
    } catch {
      return [];
    }
  }

  return cached(`swaps:${pool}:${ours}`, TTL_MS, load);
}
