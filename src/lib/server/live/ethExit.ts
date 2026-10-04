import {concatHex, parseAbi, toHex, type PublicClient} from "viem";
import {QUOTE_USDG, QUOTE_WETH, UNISWAP_QUOTER_V2} from "@/lib/contracts";
import {isEthish, pickBestQuotedHop, type SwapHop} from "@/lib/swapRoute";
import {rpc} from "./chain";
import {discoverV3Pools} from "./v3Pools";
import {quoteV4ExactIn, resolveV4PoolKeys, vanillaV4QuoteCandidates} from "./v4Pools";

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export async function quoteV3ExactIn(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
  amountIn: bigint,
  client: PublicClient,
): Promise<bigint | null> {
  try {
    const sim = await client.simulateContract({
      address: UNISWAP_QUOTER_V2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n}],
    });
    return sim.result[0];
  } catch {
    return null;
  }
}

/** Uniswap QuoterV2 multi-pool path — same surface the UI Auto Router uses for V3. */
export async function quoteV3ExactInput(
  path: `0x${string}`,
  amountIn: bigint,
  client: PublicClient,
): Promise<bigint | null> {
  try {
    const sim = await client.simulateContract({
      address: UNISWAP_QUOTER_V2,
      abi: quoterV2Abi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    return sim.result[0];
  } catch {
    return null;
  }
}

export function encodeV3HopPath(
  tokenIn: `0x${string}`,
  fee: number,
  tokenOut: `0x${string}`,
): `0x${string}` {
  return concatHex([tokenIn, toHex(fee, {size: 3}), tokenOut]);
}

export interface EthExitHop {
  amountOut: bigint;
  hop: SwapHop;
  /** WETH → USDG → pair when the deep stock book is USDG, not ETH. */
  hops?: SwapHop[];
  quoteToken: `0x${string}`;
}

function v3Hop(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
  amountIn: bigint,
  amountOut: bigint,
  quoteToken: `0x${string}`,
): EthExitHop {
  const hop: SwapHop = {
    venue: "v3",
    tokenIn,
    tokenOut,
    v3Fee: fee,
    amountIn: amountIn.toString(),
  };
  return {amountOut, hop, quoteToken};
}

function v4Hop(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  amountOut: bigint,
  quoteToken: `0x${string}`,
  key: {
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  },
): EthExitHop {
  const zeroForOne = key.currency0.toLowerCase() === tokenIn.toLowerCase();
  const hop: SwapHop = {
    venue: "v4",
    tokenIn,
    tokenOut,
    poolKey: key,
    zeroForOne,
    amountIn: amountIn.toString(),
  };
  return {amountOut, hop, quoteToken};
}

/**
 * Every Uniswap V3 fee tier QuoterV2 will answer, not just the deepest
 * liquidity() reading. Uniswap picks best output; a high-liq pool that
 * cannot fill this size loses to a smaller book that can.
 */
async function quoteAllV3(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  client: PublicClient,
): Promise<EthExitHop[]> {
  const token = tokenIn.toLowerCase() === QUOTE_WETH ? tokenOut : tokenIn;
  const hits = await discoverV3Pools([token], client, [QUOTE_WETH]);
  const quoted = await Promise.all(
    (hits.get(token.toLowerCase()) ?? []).map(async (hit) => {
      if (hit.liquidity <= 0n) return null;
      const amountOut = await quoteV3ExactIn(tokenIn, tokenOut, hit.fee, amountIn, client);
      if (amountOut == null || amountOut <= 0n) return null;
      return v3Hop(tokenIn, tokenOut, hit.fee, amountIn, amountOut, QUOTE_WETH);
    }),
  );
  return quoted.filter((row): row is EthExitHop => row != null);
}

async function quoteAllV4Eth(
  pair: `0x${string}`,
  amountIn: bigint,
  pairIn: boolean,
  client: PublicClient,
): Promise<EthExitHop[]> {
  const factory = await resolveV4PoolKeys({token: pair, client});
  const vanilla = vanillaV4QuoteCandidates(pair, [QUOTE_WETH]).filter((hit) =>
    isEthish(hit.quote),
  );
  const seen = new Set<string>();
  const hits = [...factory, ...vanilla].filter((hit) => {
    if (!isEthish(hit.quote)) return false;
    if (seen.has(hit.poolId)) return false;
    seen.add(hit.poolId);
    return true;
  });

  const quoted = await Promise.all(
    hits.map(async (hit) => {
      const tokenIn = pairIn ? pair : hit.quote;
      const tokenOut = pairIn ? hit.quote : pair;
      const zeroForOne = hit.key.currency0.toLowerCase() === tokenIn.toLowerCase();
      const result = await quoteV4ExactIn({
        key: hit.key,
        zeroForOne,
        amountIn,
        client,
      });
      if (!result.ok || result.amountOut <= 0n) return null;
      return v4Hop(tokenIn, tokenOut, amountIn, result.amountOut, hit.quote, hit.key);
    }),
  );
  return quoted.filter((row): row is EthExitHop => row != null);
}

async function quoteWethUsdg(
  amountIn: bigint,
  wethIn: boolean,
  client: PublicClient,
): Promise<EthExitHop | null> {
  const tokenIn = wethIn ? QUOTE_WETH : QUOTE_USDG;
  const tokenOut = wethIn ? QUOTE_USDG : QUOTE_WETH;
  const hits = await discoverV3Pools([QUOTE_USDG], client, [QUOTE_WETH]);
  const quoted = await Promise.all(
    (hits.get(QUOTE_USDG) ?? []).map(async (hit) => {
      if (hit.liquidity <= 0n) return null;
      const amountOut = await quoteV3ExactIn(tokenIn, tokenOut, hit.fee, amountIn, client);
      if (amountOut == null || amountOut <= 0n) return null;
      return v3Hop(tokenIn, tokenOut, hit.fee, amountIn, amountOut, QUOTE_WETH);
    }),
  );
  return pickBestQuotedHop(quoted.filter((row): row is EthExitHop => row != null));
}

async function quoteUsdgPair(
  pair: `0x${string}`,
  amountIn: bigint,
  pairIn: boolean,
  client: PublicClient,
): Promise<EthExitHop | null> {
  const tokenIn = pairIn ? pair : QUOTE_USDG;
  const tokenOut = pairIn ? QUOTE_USDG : pair;
  const candidates: EthExitHop[] = [];

  const v3Hits = await discoverV3Pools([pair], client, [QUOTE_USDG]);
  const v3Quoted = await Promise.all(
    (v3Hits.get(pair) ?? []).map(async (hit) => {
      if (hit.liquidity <= 0n) return null;
      const amountOut = await quoteV3ExactIn(tokenIn, tokenOut, hit.fee, amountIn, client);
      if (amountOut == null || amountOut <= 0n) return null;
      return v3Hop(tokenIn, tokenOut, hit.fee, amountIn, amountOut, QUOTE_WETH);
    }),
  );
  for (const row of v3Quoted) {
    if (row) candidates.push(row);
  }

  const v4Hits = [
    ...(await resolveV4PoolKeys({token: pair, client})),
    ...vanillaV4QuoteCandidates(pair, [QUOTE_USDG]),
  ].filter((hit) => hit.quote.toLowerCase() === QUOTE_USDG);
  const seen = new Set<string>();
  const v4Quoted = await Promise.all(
    v4Hits.map(async (hit) => {
      if (seen.has(hit.poolId)) return null;
      seen.add(hit.poolId);
      const zeroForOne = hit.key.currency0.toLowerCase() === tokenIn.toLowerCase();
      const result = await quoteV4ExactIn({
        key: hit.key,
        zeroForOne,
        amountIn,
        client,
      });
      if (!result.ok || result.amountOut <= 0n) return null;
      return v4Hop(tokenIn, tokenOut, amountIn, result.amountOut, QUOTE_WETH, hit.key);
    }),
  );
  for (const row of v4Quoted) {
    if (row) candidates.push(row);
  }

  return pickBestQuotedHop(candidates);
}

/**
 * Uniswap's stock route on 4663: WETH ↔ USDG (deep 0.01% V3) ↔ stock.
 * Direct stock/ETH books are often empty 5% V4; the liquid book is USDG.
 */
async function quoteViaUsdg(opts: {
  pair: `0x${string}`;
  amountIn: bigint;
  pairIn: boolean;
  client: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pair;
  if (pair === QUOTE_USDG || isEthish(pair)) return null;

  if (!opts.pairIn) {
    const first = await quoteWethUsdg(opts.amountIn, true, opts.client);
    if (!first || first.amountOut <= 0n || first.hop.v3Fee == null) return null;

    const v3PairHits = await discoverV3Pools([pair], opts.client, [QUOTE_USDG]);
    const v3Live = (v3PairHits.get(pair) ?? []).filter((hit) => hit.liquidity > 0n);
    const pathQuoted = await Promise.all(
      v3Live.map(async (hit) => {
        const path = concatHex([
          encodeV3HopPath(QUOTE_WETH, first.hop.v3Fee!, QUOTE_USDG),
          toHex(hit.fee, {size: 3}),
          pair,
        ]);
        const amountOut = await quoteV3ExactInput(path, opts.amountIn, opts.client);
        if (amountOut == null || amountOut <= 0n) return null;
        const hop2: SwapHop = {
          venue: "v3",
          tokenIn: QUOTE_USDG,
          tokenOut: pair,
          v3Fee: hit.fee,
          amountIn: first.amountOut.toString(),
        };
        return {
          amountOut,
          hop: first.hop,
          hops: [first.hop, hop2],
          quoteToken: QUOTE_WETH,
        } satisfies EthExitHop;
      }),
    );

    const second = await quoteUsdgPair(pair, first.amountOut, false, opts.client);
    const viaPath: EthExitHop[] = [];
    for (const row of pathQuoted) {
      if (row) viaPath.push(row);
    }
    let best = pickBestQuotedHop(viaPath);
    if (second && second.amountOut > 0n) {
      const mixed: EthExitHop = {
        amountOut: second.amountOut,
        hop: first.hop,
        hops: [first.hop, second.hop],
        quoteToken: QUOTE_WETH,
      };
      best = pickBestQuotedHop(best ? [best, mixed] : [mixed]);
    }
    return best;
  }

  const first = await quoteUsdgPair(pair, opts.amountIn, true, opts.client);
  if (!first || first.amountOut <= 0n) return null;
  const second = await quoteWethUsdg(first.amountOut, false, opts.client);
  if (!second || second.amountOut <= 0n) return null;
  if (first.hop.v3Fee != null && second.hop.v3Fee != null) {
    const path = concatHex([
      encodeV3HopPath(pair, first.hop.v3Fee, QUOTE_USDG),
      toHex(second.hop.v3Fee, {size: 3}),
      QUOTE_WETH,
    ]);
    const pathOut = await quoteV3ExactInput(path, opts.amountIn, opts.client);
    if (pathOut != null && pathOut > second.amountOut) {
      return {
        amountOut: pathOut,
        hop: first.hop,
        hops: [first.hop, second.hop],
        quoteToken: QUOTE_WETH,
      };
    }
  }
  return {
    amountOut: second.amountOut,
    hop: first.hop,
    hops: [first.hop, second.hop],
    quoteToken: QUOTE_WETH,
  };
}

async function quoteDirectEth(opts: {
  pair: `0x${string}`;
  amountIn: bigint;
  pairIn: boolean;
  client: PublicClient;
}): Promise<EthExitHop | null> {
  const tokenIn = opts.pairIn ? opts.pair : QUOTE_WETH;
  const tokenOut = opts.pairIn ? QUOTE_WETH : opts.pair;
  const [v3, v4] = await Promise.all([
    quoteAllV3(tokenIn, tokenOut, opts.amountIn, opts.client),
    quoteAllV4Eth(opts.pair, opts.amountIn, opts.pairIn, opts.client),
  ]);
  return pickBestQuotedHop([...v3, ...v4]);
}

/**
 * Second hop: pair token (SPCX, USDG, IBM, …) → WETH or native ETH.
 * Quotes every Uniswap V3/V4 candidate plus WETH↔USDG↔stock. Null when
 * no live hop exists — the ticket must fail honestly.
 */
export async function quotePairToEth(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (isEthish(pair) || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();
  if (pair === QUOTE_USDG) {
    return quoteWethUsdg(opts.amountIn, false, client);
  }

  const [direct, viaUsdg] = await Promise.all([
    quoteDirectEth({pair, amountIn: opts.amountIn, pairIn: true, client}),
    quoteViaUsdg({pair, amountIn: opts.amountIn, pairIn: true, client}),
  ]);
  return pickBestQuotedHop([direct, viaUsdg].filter((row): row is EthExitHop => row != null));
}

/**
 * USDG → pair, one hop. WETH comes from the deep WETH/USDG 0.01% book; a stock
 * from its own USDG book. A USD-paid buy of a token that has no USDG pool of
 * its own enters through here.
 */
export async function quoteUsdgToPair(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (pair === QUOTE_USDG || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();
  if (isEthish(pair)) return quoteWethUsdg(opts.amountIn, false, client);
  return quoteUsdgPair(pair, opts.amountIn, false, client);
}

/** Pair → USDG, one hop. The exit of a USD-received sell with no USDG pool. */
export async function quotePairToUsdg(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (pair === QUOTE_USDG || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();
  if (isEthish(pair)) return quoteWethUsdg(opts.amountIn, true, client);
  return quoteUsdgPair(pair, opts.amountIn, true, client);
}

/**
 * First hop of a stock-paired buy: ETH/WETH → pair (SPCX, IBM, SPY, …).
 *
 * Does not invent a fee tier. Uniswap QuoterV2 + V4 Quoter answer every
 * standard candidate (V3 WETH fees, hookless V4 ETH/WETH, and the
 * WETH→USDG→stock path the 4663 UI uses). Highest amountOut wins.
 */
export async function quoteEthToPair(opts: {
  pairToken: `0x${string}`;
  amountIn: bigint;
  client?: PublicClient;
}): Promise<EthExitHop | null> {
  const pair = opts.pairToken.toLowerCase() as `0x${string}`;
  if (isEthish(pair) || opts.amountIn <= 0n) return null;
  const client = opts.client ?? rpc();
  if (pair === QUOTE_USDG) {
    return quoteWethUsdg(opts.amountIn, true, client);
  }

  const [direct, viaUsdg] = await Promise.all([
    quoteDirectEth({pair, amountIn: opts.amountIn, pairIn: false, client}),
    quoteViaUsdg({pair, amountIn: opts.amountIn, pairIn: false, client}),
  ]);
  return pickBestQuotedHop([direct, viaUsdg].filter((row): row is EthExitHop => row != null));
}
