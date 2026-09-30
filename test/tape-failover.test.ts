import {afterEach, beforeEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {
  TAPE_RPC_BUDGET_MS,
  decimalsOf,
  recentSwaps,
  rpc,
  scaled,
  windowBlocks,
} from "../src/lib/server/live/swaps";
import {resetLiveCacheForTests} from "../src/lib/server/live/cache";

/**
 * The tape's head read sat about two minutes behind the chain in production.
 *
 * Its RPC helper moved to the next provider only on a rate limit, and the
 * first provider (a revoked Alchemy key) answered every `eth_getLogs` with a
 * 401. So each read ended on the first try, the tape fell back to the
 * indexer's fills, and the failure was swallowed into an empty list. Its window
 * was also nine blocks, sized for one-second blocks on a chain that makes one
 * every ~100ms: under a second of history against a two-second poll.
 */

const realFetch = globalThis.fetch;
const env = {...process.env};

type Reply = (init: RequestInit) => Promise<Response>;

function stubProviders(replies: Record<string, Reply>): string[] {
  const hits: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).hostname;
    hits.push(host);
    const reply = replies[host];
    if (!reply) throw new Error(`unexpected host ${host}`);
    return reply(init ?? {});
  }) as typeof fetch;
  return hits;
}

const json = (body: unknown, status = 200) => async () =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

/** Never answers; rejects when the caller's timeout aborts it, as fetch does. */
const hang: Reply = (init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("tape rpc failover", () => {
  beforeEach(() => {
    process.env.ALCHEMY_RPC_URL = "https://alchemy.example/v2/secret-key";
    process.env.CHAINSTACK_RPC_URL = "https://chainstack.example/secret-key";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = {...env};
  });

  it("moves on from a provider that rejects the request outright", async () => {
    const hits = stubProviders({
      "alchemy.example": json(
        {jsonrpc: "2.0", id: 1, error: {code: -32600, message: "Must be authenticated!"}},
        401,
      ),
      "chainstack.example": json({jsonrpc: "2.0", id: 1, result: "0x10"}),
    });
    assert.equal(await rpc<string>("eth_getLogs", []), "0x10");
    assert.deepEqual(hits, ["alchemy.example", "chainstack.example"]);
  });

  it("moves on from a JSON-RPC error that is not a rate limit", async () => {
    stubProviders({
      "alchemy.example": json({jsonrpc: "2.0", id: 1, error: {message: "JSON is not a valid request object"}}),
      "chainstack.example": json({jsonrpc: "2.0", id: 1, result: []}),
    });
    assert.deepEqual(await rpc<unknown[]>("eth_getLogs", []), []);
  });

  it("moves on from a provider that hangs, within the budget", async () => {
    stubProviders({
      "alchemy.example": hang,
      "chainstack.example": json({jsonrpc: "2.0", id: 1, result: "0x1"}),
    });
    const started = Date.now();
    assert.equal(await rpc<string>("eth_blockNumber", []), "0x1");
    assert.ok(Date.now() - started < TAPE_RPC_BUDGET_MS, "took longer than the budget");
  });

  it("throws, naming each provider's reason but never its URL", async () => {
    stubProviders({
      "alchemy.example": json({error: {message: "Must be authenticated!"}}, 401),
      "chainstack.example": json({jsonrpc: "2.0", id: 1, error: {message: "boom"}}),
      "rpc.mainnet.chain.robinhood.com": json({}, 503),
    });
    await assert.rejects(rpc("eth_getLogs", []), (error: Error) => {
      assert.match(error.message, /alchemy\.example: HTTP 401/);
      assert.match(error.message, /chainstack\.example: boom/);
      assert.match(error.message, /robinhood\.com: HTTP 503/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    });
  });

  it("gives up once the budget is spent rather than waiting on every provider", async () => {
    stubProviders({
      "alchemy.example": hang,
      "chainstack.example": hang,
      "rpc.mainnet.chain.robinhood.com": hang,
    });
    const started = Date.now();
    await assert.rejects(rpc("eth_getLogs", [], Date.now() + 300));
    assert.ok(Date.now() - started < 1_000, "a spent budget still waited");
  });
});

describe("tape window", () => {
  it("covers about four seconds at the chain's measured block time", () => {
    assert.equal(windowBlocks(100), 40n);
    assert.equal(windowBlocks(1_000), 4n);
  });

  it("falls back to the measured block time when the estimate is unusable", () => {
    assert.equal(windowBlocks(0), 40n);
    assert.equal(windowBlocks(Number.NaN), 40n);
  });

  it("is bounded both ways", () => {
    assert.equal(windowBlocks(1), 200n);
    assert.equal(windowBlocks(60_000), 2n);
  });
});

describe("tape amounts", () => {
  // USDG has six decimals. Dividing its leg by 1e18 printed a $1,000 fill as
  // $0.00 at a price of $0.0000000002 on every USDG pool.
  it("scales each side by its own decimals", () => {
    assert.equal(scaled(1_000_000_000n, 6), 1_000);
    assert.equal(scaled(-2_500_000n, 6), 2.5);
    assert.equal(scaled(3n * 10n ** 18n, 18), 3);
  });

  it("knows the quote assets and stocks without asking the chain", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    try {
      assert.equal(await decimalsOf("0x5fc5360d0400a0fd4f2af552add042d716f1d168"), 6); // USDG
      assert.equal(await decimalsOf("0x0BD7D308F8E1639FAB988DF18A8011F41EACAD73"), 18); // WETH
      assert.equal(await decimalsOf("0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"), 18); // NVDA
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("tape decimals are read, never assumed", () => {
  const realFetch = globalThis.fetch;
  const env = {...process.env};

  beforeEach(() => {
    process.env.ALCHEMY_RPC_URL = "";
    process.env.CHAINSTACK_RPC_URL = "https://chainstack.example/secret-key";
    resetLiveCacheForTests();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = {...env};
    resetLiveCacheForTests();
  });

  /** One stubbed provider answering by method; the public RPC fails. */
  function chain(answers: Record<string, (params: unknown[]) => unknown>): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes("chainstack.example")) {
        return new Response("{}", {status: 503});
      }
      const {method, params} = JSON.parse(String(init?.body));
      asked.push(method);
      const answer = answers[method];
      const body = answer
        ? {jsonrpc: "2.0", id: 1, result: answer(params)}
        : {jsonrpc: "2.0", id: 1, error: {message: `no ${method}`}};
      return new Response(JSON.stringify(body), {status: 200});
    }) as typeof fetch;
    return asked;
  }

  it("is unknown, not 18, when the read fails", async () => {
    chain({});
    assert.equal(await decimalsOf("0x1111111111111111111111111111111111111111"), null);
  });

  it("is unknown when the contract's answer is not a decimals value", async () => {
    chain({eth_call: () => "0x" + "f".repeat(64)});
    assert.equal(await decimalsOf("0x2222222222222222222222222222222222222222"), null);
  });

  it("remembers a real answer, and only a real answer", async () => {
    const asked = chain({eth_call: () => "0x" + "6".padStart(64, "0")});
    const token = "0x3333333333333333333333333333333333333333";
    assert.equal(await decimalsOf(token), 6);
    assert.equal(await decimalsOf(token), 6);
    assert.equal(asked.filter((m) => m === "eth_call").length, 1);
  });

  it("fails the read rather than pricing fills for a token it cannot size", async () => {
    // A launchpad token (not a known quote asset, not a stock) whose
    // decimals() read fails, in a USDG pool with one swap in the window.
    const token = "0x4444444444444444444444444444444444444444";
    const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
    const pool = "0x5555555555555555555555555555555555555555";
    chain({
      eth_blockNumber: () => "0x1000",
      eth_getBlockByNumber: () => ({timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16)}),
      eth_getLogs: () => [
        {
          address: pool,
          topics: ["0x0", "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          data: "0x" + "0".repeat(64 * 5),
          blockNumber: "0x1000",
          transactionHash: "0x" + "a".repeat(64),
          logIndex: "0x0",
        },
      ],
      // no eth_call: the decimals read fails
    });
    await assert.rejects(
      recentSwaps(pool, token, usdg, 1, 1),
      /decimals unknown for 0x4444/,
    );
  });

  /** One v3 swap: the pool paid out a whole token for 0.001 WETH. */
  function wethSwap(pool: string) {
    const word = (value: bigint) =>
      (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, "0");
    chain({
      eth_blockNumber: () => "0x1000",
      eth_getBlockByNumber: () => ({timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16)}),
      eth_call: () => "0x" + "12".padStart(64, "0"),
      eth_getLogs: () => [
        {
          address: pool,
          topics: ["0x0", "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          data:
            "0x" +
            word(-(10n ** 18n)) +
            word(10n ** 15n) +
            word(1n) +
            word(1n) +
            word(0n),
          blockNumber: "0x1000",
          transactionHash: "0x" + "b".repeat(64),
          logIndex: "0x0",
        },
      ],
    });
  }

  it("leaves out a fill it cannot price when the token is unpriced", async () => {
    // WETH has no USD price on this path, so the only price left for the fill
    // would be the token's own — and an unpriced token has none to lend it.
    const token = "0x0666666666666666666666666666666666666666";
    const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    wethSwap("0x7777777777777777777777777777777777777777");
    assert.deepEqual(
      await recentSwaps("0x7777777777777777777777777777777777777777", token, weth, null, null),
      [],
    );
  });

  it("still prices that fill from the token when it has a price", async () => {
    const token = "0x0666666666666666666666666666666666666666";
    const weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    wethSwap("0x8888888888888888888888888888888888888888");
    const fills = await recentSwaps(
      "0x8888888888888888888888888888888888888888",
      token,
      weth,
      0.002,
      null,
    );
    assert.equal(fills.length, 1);
    assert.equal(fills[0].priceUsd, 0.002);
    assert.equal(fills[0].side, "buy");
  });
});
