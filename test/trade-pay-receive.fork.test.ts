/**
 * Pay with USD (USDG) or ETH, receive USD or ETH: every route on an Anvil fork
 * of Robinhood Chain 4663, through the app's own quote API and transaction
 * builders, signed the way the ticket signs them.
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545
 *   FORK_RPC_URL=http://127.0.0.1:8545 node --import ./test/resolver.mjs --test test/trade-pay-receive.fork.test.ts
 *
 * Skipped without FORK_RPC_URL, so `npm test` stays offline.
 */
import {after, before, describe, it} from "node:test";
import assert from "node:assert/strict";
import {formatUnits, parseAbi, type Hex, type PublicClient} from "viem";

const FORK = process.env.FORK_RPC_URL;

const V2_ROUTER = "0xbcf97c486db56642bd27fcbe9cdebed9a72468eb" as const;
const V2_COLLECTOR = "0x380b8ced6f27c3800ba9f16796a34ea74cc3bfcf" as const;
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

const TOKENS = {
  FIG: "0x41f4267525a8aff329540ef24fd83d9044758b33", // Figma stock, V3 vs USDG
  ORBIO: "0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3", // Pons, V3 vs WETH
  AI: "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18", // Long, V3 vs WETH
} as const;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

type Mods = {
  route: typeof import("../src/app/api/quote/route");
  swapQuote: typeof import("../src/lib/swapQuote");
  swapTx: typeof import("../src/lib/swapTx");
  hodl: typeof import("../src/lib/hodlRouter");
  live: typeof import("../src/lib/liveTrade");
  policy: typeof import("../src/lib/tradePolicy");
  ticket: typeof import("../src/lib/tradeTicket");
  approval: typeof import("../src/lib/approvalFlow");
  contracts: typeof import("../src/lib/contracts");
  venue: typeof import("../src/lib/venueQuote");
};

describe("pay / receive USD or ETH on a 4663 fork", {skip: !FORK}, () => {
  let m: Mods;
  let client: PublicClient;
  let wallet: ReturnType<typeof import("../scripts/fork/harness").forkWalletClient>;
  let me: `0x${string}`;
  const forkRpcUrl = () => process.env.FORK_RPC_URL || "http://127.0.0.1:8545";
  const realFetch = globalThis.fetch;
  const rows: string[] = [];

  async function rpc(method: string, params: unknown[]) {
    const res = await realFetch(forkRpcUrl(), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
    });
    const body = (await res.json()) as {result?: unknown; error?: {message: string}};
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  before(async () => {
    // The app reads 4663 through its public RPC fallback. Point that at the fork.
    delete process.env.ALCHEMY_RPC_URL;
    delete process.env.CHAINSTACK_RPC_URL;
    process.env.NEXT_PUBLIC_HODL_ROUTER = V2_ROUTER;
    process.env.NEXT_PUBLIC_FEE_COLLECTOR = V2_COLLECTOR;
    process.env.NEXT_PUBLIC_LIVE_TRADE = "1";
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.replace(/\/$/, "") === PUBLIC_RPC) return realFetch(forkRpcUrl(), init);
      return realFetch(input, init);
    }) as typeof fetch;

    m = {
      route: await import("../src/app/api/quote/route"),
      swapQuote: await import("../src/lib/swapQuote"),
      swapTx: await import("../src/lib/swapTx"),
      hodl: await import("../src/lib/hodlRouter"),
      live: await import("../src/lib/liveTrade"),
      policy: await import("../src/lib/tradePolicy"),
      ticket: await import("../src/lib/tradeTicket"),
      approval: await import("../src/lib/approvalFlow"),
      contracts: await import("../src/lib/contracts"),
      venue: await import("../src/lib/venueQuote"),
    };
    assert.equal(m.contracts.HODL_ROUTER, V2_ROUTER, "app resolves the v2 router");
    assert.equal(m.contracts.FEE_COLLECTOR, V2_COLLECTOR, "app resolves the v2 collector");
    // The harness reads contracts.ts, so it loads after the env above.
    const harness = await import("../scripts/fork/harness");
    client = harness.forkPublicClient();
    wallet = harness.forkWalletClient();
    me = harness.forkAnvilAccount().address.toLowerCase() as `0x${string}`;
    assert.equal(await client.getChainId(), 4663);

    // Anvil's default key is public, and on 4663 it carries delegated code that
    // sweeps any ETH it receives. Make the test wallet a plain account again.
    await rpc("anvil_setCode", [me, "0x"]);

    // Fund the test wallet with 100 USDG from the WETH/USDG pool.
    const pool = m.contracts.WETH_USDG_V3_POOL;
    await rpc("anvil_impersonateAccount", [pool]);
    await rpc("anvil_setBalance", [pool, "0xde0b6b3a7640000"]);
    const data = (await import("viem")).encodeFunctionData({abi: erc20, functionName: "transfer", args: [me, 100_000_000n]});
    const hash = (await rpc("eth_sendTransaction", [{from: pool, to: m.contracts.QUOTE_USDG, data}])) as Hex;
    await client.waitForTransactionReceipt({hash});
    await rpc("anvil_stopImpersonatingAccount", [pool]);
  });

  after(() => {
    globalThis.fetch = realFetch;
    if (rows.length) console.log(`\n${rows.join("\n")}\n`);
  });

  async function bal(token: string, who: string): Promise<bigint> {
    if (token === m.contracts.QUOTE_ETH) return client.getBalance({address: who as `0x${string}`});
    return client.readContract({address: token as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [who as `0x${string}`]});
  }

  async function send(tx: {to: `0x${string}`; data: Hex; value: bigint}): Promise<{hash: Hex; gasCost: bigint}> {
    const hash = await wallet.sendTransaction({to: tx.to, data: tx.data, value: tx.value, account: wallet.account!, chain: wallet.chain});
    const receipt = await client.waitForTransactionReceipt({hash, timeout: 120_000});
    if (receipt.status !== "success") {
      // Replay it one block earlier for the revert reason.
      const why = await client
        .call({account: wallet.account!, to: tx.to, data: tx.data, value: tx.value, blockNumber: receipt.blockNumber - 1n})
        .then(() => "no revert on replay")
        .catch((error: unknown) => (error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : String(error)));
      assert.fail(`tx ${hash} reverted: ${why}`);
    }
    return {hash, gasCost: receipt.gasUsed * receipt.effectiveGasPrice};
  }

  async function quote(token: string, side: "buy" | "sell", amountIn: bigint, currency: "eth" | "usdg") {
    const debug = process.env.FORK_DEBUG === "1";
    const param = side === "buy" ? "pay" : "receive";
    // A cold fork pulls state from the public RPC slowly enough that the app's
    // 12 s read timeout can drop a pool on the first try. Warm up and retry.
    let parsed = {ok: false} as ReturnType<typeof m.swapQuote.parseSwapQuote>;
    for (let attempt = 0; attempt < 3 && !parsed.ok; attempt++) {
      const res = await m.route.GET(
        new Request(`http://local/api/quote?token=${token}&side=${side}&amountIn=${amountIn}&${param}=${currency}`),
      );
      parsed = m.swapQuote.parseSwapQuote(await res.json());
    }
    assert.ok(parsed.ok, `no quote for ${side} ${token} ${currency}: ${!parsed.ok ? parsed.error : ""}`);
    if (debug) {
      const q = parsed.quote;
      console.log(JSON.stringify({side, currency, venue: q.venue, label: q.venueLabel, v3Fee: q.v3Fee, v3Pool: q.v3Pool, amountIn: q.amountIn, amountOut: q.amountOut, netOut: q.netOut, quoteToken: q.quoteToken, pairToken: q.pairToken, hops: q.hops.map((h) => `${h.venue}:${h.tokenIn.slice(0, 6)}>${h.tokenOut.slice(0, 6)}:${h.v3Fee ?? "k"}`)}));
    }
    return parsed.quote;
  }

  /** Sign a quote exactly as the ticket would: router when it can, else the direct path. */
  async function trade(token: `0x${string}`, side: "buy" | "sell", q: Awaited<ReturnType<typeof quote>>) {
    let approvalGas = 0n;
    const approve = async (tx: {to: `0x${string}`; data: Hex; value: bigint}) => {
      approvalGas += (await send(tx)).gasCost;
    };
    const slippagePct = 1;
    const amountIn = BigInt(q.amountIn);
    const payNative = side === "buy" && m.ticket.buyPaysNative(q);
    const viaRouter = m.live.hodlCanExecuteQuote(q, side);
    const spend = side === "sell" ? token : payNative ? null : ((q.hops[0]?.tokenIn ?? q.quoteToken) as `0x${string}`);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    if (viaRouter) {
      const minOut = m.policy.hodlRouterMinOut({
        router: V2_ROUTER,
        side,
        amountOut: BigInt(q.amountOut),
        netOut: BigInt(q.netOut),
        slippagePct,
      });
      const hint = m.hodl.hintFromQuote(q, token, side);
      if (spend) await approve(m.approval.encodeHodlApprove(spend, V2_ROUTER, amountIn));
      const ZERO = "0x0000000000000000000000000000000000000000" as const;
      const tx = payNative
        ? m.hodl.encodeHodlBuy({router: V2_ROUTER, tokenOut: token, minAmountOut: minOut, hint, deadline, value: amountIn})
        : side === "buy"
          ? m.hodl.encodeHodlBuyWithToken({router: V2_ROUTER, tokenIn: q.quoteToken, amountIn, tokenOut: token, minAmountOut: minOut, hint, deadline})
          : m.hodl.encodeHodlSell({
              router: V2_ROUTER,
              tokenIn: token,
              amountIn,
              tokenOut: q.quoteIsNative || q.quoteIsWeth ? ZERO : q.quoteToken,
              minAmountOut: minOut,
              hint,
              deadline,
            });
      const sent = await send(tx);
      return {route: "HodlRouter v2", minOut, hash: sent.hash, gasCost: sent.gasCost + approvalGas};
    }

    const minOut =
      side === "buy"
        ? m.policy.requireBuyMinOut(amountIn, m.policy.amountOutMinimum(BigInt(q.amountOut), slippagePct), payNative ? null : spend)
        : m.policy.amountOutMinimum(BigInt(q.amountOut), slippagePct);
    if (spend) {
      await approve(m.swapTx.encodeApprove(spend, m.contracts.PERMIT2, amountIn));
      await approve(m.swapTx.encodePermit2Approve(spend, m.contracts.UNIVERSAL_ROUTER, amountIn, m.swapTx.permit2Expiry()));
    }
    const tx = m.swapTx.prepareExactInSwap({
      venue: q.venue,
      side,
      token,
      quoteToken: q.quoteToken,
      quoteIsNative: q.quoteIsNative,
      quoteIsWeth: q.quoteIsWeth,
      poolKey: q.poolKey,
      v3Fee: q.v3Fee,
      zeroForOne: q.zeroForOne,
      amountIn,
      amountOutMinimum: minOut,
      deadline,
      recipient: me,
      payNative,
      hops: q.hops,
    });
    // Sells and token-paid buys check the seller's minimum after the fee.
    const userMin = side === "sell" ? m.venue.inputAfterBuyFee(minOut) : minOut;
    const sent = await send(tx);
    return {
      route: `Universal Router (${q.hops.length || 1} hop${q.hops.length > 1 ? "s" : ""})`,
      minOut: userMin,
      hash: sent.hash,
      gasCost: sent.gasCost + approvalGas,
    };
  }

  const ETH_ADDR = "0x0000000000000000000000000000000000000000";

  async function snapshot(token: string) {
    const c = m.contracts;
    return {
      eth: await bal(ETH_ADDR, me),
      usdg: await bal(c.QUOTE_USDG, me),
      token: await bal(token, me),
      feeEth: await bal(ETH_ADDR, V2_COLLECTOR),
      feeWeth: await bal(c.QUOTE_WETH, V2_COLLECTOR),
      feeUsdg: await bal(c.QUOTE_USDG, V2_COLLECTOR),
      router: [
        await bal(ETH_ADDR, V2_ROUTER),
        await bal(c.QUOTE_WETH, V2_ROUTER),
        await bal(c.QUOTE_USDG, V2_ROUTER),
        await bal(token, V2_ROUTER),
      ],
    };
  }

  // The public RPC prunes state after ~10 minutes, so run one token per fresh
  // fork: FORK_TOKENS=FIG (default: all).
  const only = (process.env.FORK_TOKENS ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const picked = (Object.entries(TOKENS) as [keyof typeof TOKENS, `0x${string}`][]).filter(
    ([name]) => only.length === 0 || only.includes(name),
  );
  for (const [name, token] of picked) {
    describe(name, () => {
      for (const pay of ["usdg", "eth"] as const) {
        it(`buy paying ${pay.toUpperCase()}`, async () => {
          const amountIn = pay === "usdg" ? 5_000_000n : 2_000_000_000_000_000n; // $5 USDG or 0.002 ETH
          const q = await quote(token, "buy", amountIn, pay);
          const before = await snapshot(token);
          const done = await trade(token, "buy", q);
          const after = await snapshot(token);

          const got = after.token - before.token;
          assert.ok(got >= done.minOut, `received ${got} < min ${done.minOut}`);
          const fee = m.venue.feeOnAmount(amountIn);
          if (pay === "usdg") {
            assert.equal(before.usdg - after.usdg, amountIn, "spent exactly the USDG entered");
            assert.equal(after.feeUsdg - before.feeUsdg, fee, "fee is 50 bps of the input, in USDG");
          } else {
            assert.equal(before.eth - after.eth - done.gasCost, amountIn, "spent exactly the ETH entered");
            assert.equal(after.feeEth - before.feeEth, fee, "fee is 50 bps of the input, in ETH");
          }
          assert.deepEqual(after.router, before.router, "router holds nothing extra");
          rows.push(
            `${name.padEnd(5)} buy  pay ${pay.toUpperCase().padEnd(4)} ${done.route.padEnd(30)} in ${formatUnits(amountIn, pay === "usdg" ? 6 : 18)} → ${formatUnits(got, q.tokenDecimals)} ${name} (min ${formatUnits(done.minOut, q.tokenDecimals)}) fee ${formatUnits(fee, pay === "usdg" ? 6 : 18)} ${pay.toUpperCase()} tx ${done.hash}`,
          );
        });
      }

      for (const receive of ["usdg", "eth"] as const) {
        it(`sell receiving ${receive.toUpperCase()}`, async () => {
          const held = await bal(token, me);
          assert.ok(held > 0n, "bought tokens to sell");
          const amountIn = receive === "usdg" ? held / 2n : held; // half, then the rest
          const q = await quote(token, "sell", amountIn, receive);
          const before = await snapshot(token);
          const done = await trade(token, "sell", q);
          const after = await snapshot(token);

          assert.equal(before.token - after.token, amountIn, "sold exactly the amount entered");
          const got = receive === "usdg" ? after.usdg - before.usdg : after.eth - before.eth + done.gasCost;
          assert.ok(got >= done.minOut, `received ${got} < min after fee ${done.minOut} (tx ${done.hash})`);
          const fee =
            receive === "usdg"
              ? after.feeUsdg - before.feeUsdg
              : after.feeEth - before.feeEth + (after.feeWeth - before.feeWeth);
          assert.ok(fee > 0n, "fee charged");
          assert.equal(fee, ((got + fee) * 50n) / 10_000n, "fee is 50 bps of the swap output");
          assert.deepEqual(after.router, before.router, "router holds nothing extra");
          rows.push(
            `${name.padEnd(5)} sell get ${receive.toUpperCase().padEnd(4)} ${done.route.padEnd(30)} in ${formatUnits(amountIn, q.tokenDecimals)} ${name} → ${formatUnits(got, receive === "usdg" ? 6 : 18)} ${receive.toUpperCase()} (min ${formatUnits(done.minOut, receive === "usdg" ? 6 : 18)}) fee ${formatUnits(fee, receive === "usdg" ? 6 : 18)} tx ${done.hash}`,
          );
        });
      }
    });
  }
});
