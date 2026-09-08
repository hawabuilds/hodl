import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {decodeAbiParameters, decodeFunctionData, parseAbi} from "viem";
import {
  packActions,
  UR_COMMAND_V4_SWAP,
  V4_ACTION_SETTLE,
  V4_ACTION_SETTLE_ALL,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE,
  V4_ACTION_TAKE_ALL,
} from "../src/lib/v4Encoding";
import {
  LONG_DOPPLER_HOOK,
  QUOTE_WETH,
  UNIVERSAL_ROUTER,
  UNISWAP_SWAP_ROUTER_02,
} from "../src/lib/contracts";
import {encodeHodlBuy, encodeHodlSell, hodlRouterAbi} from "../src/lib/hodlRouter";
import {CANT_EXIT_TO_ETH, entryHopTooThin} from "../src/lib/swapRoute";
import {
  LIVE_BUY_OVER_CAP,
  ROUTE_NO_LIQUIDITY,
  amountOutMinimum,
  assertSaneUrBuy,
  intermediateOutIsDust,
  liveBuyOverCap,
  outputValueTooLow,
  priceImpactBps,
  quoteMissButtonLabel,
  quoteMissReason,
  refuseUnsafeBuyQuote,
  requireBuyMinOut,
  ticketBlockReason,
} from "../src/lib/tradePolicy";
import {parseSwapQuote} from "../src/lib/swapQuote";
import {
  assertSwapNotErc20Transfer,
  buildV3Swap,
  buildV4Swap,
  encodeTransfer,
  ERC20_TRANSFER_SELECTOR,
  isErc20TransferCalldata,
  isTransferToSwapRouter,
  packCommands,
  prepareExactInSwap,
  UR_COMMAND_PERMIT2_TRANSFER_FROM,
  UR_COMMAND_UNWRAP_WETH,
  UR_COMMAND_V3_SWAP_EXACT_IN,
  UR_COMMAND_WRAP_ETH,
  encodePermit2Pull,
} from "../src/lib/swapTx";

const urAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

function executeCommands(data: `0x${string}`): string {
  const decoded = decodeFunctionData({abi: urAbi, data});
  return String(decoded.args[0]);
}

function v4ActionsFromExecute(data: `0x${string}`, which = 0): string {
  const decoded = decodeFunctionData({abi: urAbi, data});
  const commands = String(decoded.args[0]).slice(2);
  const bytes: string[] = commands.match(/.{2}/g) ?? [];
  const needle = UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0");
  const hits = bytes
    .map((byte, i) => (byte === needle ? i : -1))
    .filter((i) => i >= 0);
  const index = hits[which] ?? hits[0];
  const input = decoded.args[1][index] as `0x${string}`;
  const [actions] = decodeAbiParameters(
    [{type: "bytes"}, {type: "bytes[]"}],
    input,
  );
  return actions;
}

function v4SwapField(
  data: `0x${string}`,
  which: number,
  field: "amountIn" | "amountOutMinimum",
): bigint {
  const decoded = decodeFunctionData({abi: urAbi, data});
  const commands = String(decoded.args[0]).slice(2);
  const bytes: string[] = commands.match(/.{2}/g) ?? [];
  const needle = UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0");
  const hits = bytes
    .map((byte, i) => (byte === needle ? i : -1))
    .filter((i) => i >= 0);
  const index = hits[which] ?? hits[0];
  const input = decoded.args[1][index] as `0x${string}`;
  const [, params] = decodeAbiParameters(
    [{type: "bytes"}, {type: "bytes[]"}],
    input,
  );
  for (const param of params) {
    try {
      const [swap] = decodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              {
                name: "poolKey",
                type: "tuple",
                components: [
                  {name: "currency0", type: "address"},
                  {name: "currency1", type: "address"},
                  {name: "fee", type: "uint24"},
                  {name: "tickSpacing", type: "int24"},
                  {name: "hooks", type: "address"},
                ],
              },
              {name: "zeroForOne", type: "bool"},
              {name: "amountIn", type: "uint128"},
              {name: "amountOutMinimum", type: "uint128"},
              {name: "minHopPriceX36", type: "uint256"},
              {name: "hookData", type: "bytes"},
            ],
          },
        ],
        param,
      );
      return BigInt(swap[field]);
    } catch {
      // next param
    }
  }
  throw new Error("no swap param");
}

const KEY = {
  currency0: "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const,
  currency1: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const,
  fee: 100,
  tickSpacing: 1,
  hooks: "0x0000000000000000000000000000000000000000" as const,
};

describe("swap tx encoding", () => {
  it("packs Permit2 pull in front of V4_SWAP", () => {
    const tx = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
    });
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.value, 0n);
    assert.match(tx.data, /^0x/);
    assert.equal(
      packCommands([UR_COMMAND_PERMIT2_TRANSFER_FROM, UR_COMMAND_V4_SWAP]),
      "0x0210",
    );
  });

  it("encodes PERMIT2_TRANSFER_FROM as (token, recipient, amount)", () => {
    const token = KEY.currency1;
    const amount = 10n ** 16n;
    const encoded = encodePermit2Pull(token, amount, UNIVERSAL_ROUTER);
    const [gotToken, recipient, gotAmount] = decodeAbiParameters(
      [{type: "address"}, {type: "address"}, {type: "uint160"}],
      encoded,
    );
    assert.equal(gotToken.toLowerCase(), token);
    assert.equal(recipient.toLowerCase(), UNIVERSAL_ROUTER);
    assert.equal(gotAmount, amount);
    const swapped = decodeAbiParameters(
      [{type: "address"}, {type: "uint160"}, {type: "address"}],
      encoded,
    );
    assert.notEqual(swapped[1], amount);
    assert.notEqual(swapped[2].toLowerCase(), UNIVERSAL_ROUTER);

    const sell = prepareExactInSwap({
      venue: "v4",
      side: "sell",
      token,
      quoteToken: QUOTE_WETH,
      quoteIsWeth: true,
      poolKey: {
        currency0: QUOTE_WETH,
        currency1: token,
        fee: 100,
        tickSpacing: 1,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      zeroForOne: false,
      amountIn: amount,
      amountOutMinimum: 1n,
      deadline: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      payNative: false,
    });
    const decoded = decodeFunctionData({abi: urAbi, data: sell.data});
    const [pullToken, pullTo, pullAmount] = decodeAbiParameters(
      [{type: "address"}, {type: "address"}, {type: "uint160"}],
      decoded.args[1][0],
    );
    assert.equal(pullToken.toLowerCase(), token);
    assert.equal(pullTo.toLowerCase(), UNIVERSAL_ROUTER);
    assert.equal(pullAmount, amount);
  });

  it("sends value for native ETH and wraps WETH", () => {
    const native = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      nativeIn: true,
    });
    assert.equal(native.value, 10n ** 16n);

    const wrapped = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      wrapEth: true,
    });
    assert.equal(wrapped.value, 10n ** 16n);
    assert.equal(packCommands([UR_COMMAND_WRAP_ETH, UR_COMMAND_V4_SWAP]), "0x0b10");
  });

  it("uses SETTLE from the router when tokens are already there", () => {
    const tx = buildV4Swap({
      poolKey: KEY,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      alreadyOnRouter: true,
    });
    assert.equal(tx.value, 0n);
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.ok(tx.data.length > 10);
    assert.equal(
      [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE, V4_ACTION_TAKE_ALL].join(","),
      "6,11,15",
    );
    assert.equal(
      [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, V4_ACTION_TAKE_ALL].join(","),
      "6,12,15",
    );
  });

  it("encodes a V4 or V3 sell as execute/unwrap to ETH, never transfer to the router", () => {
    const recipient = "0x1111111111111111111111111111111111111111" as const;
    const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const wethKey = {
      currency0: QUOTE_WETH,
      currency1: token,
      fee: 100,
      tickSpacing: 1,
      hooks: "0x0000000000000000000000000000000000000000" as const,
    };
    const v4Sell = prepareExactInSwap({
      venue: "v4",
      side: "sell",
      token,
      quoteToken: QUOTE_WETH,
      quoteIsWeth: true,
      poolKey: wethKey,
      zeroForOne: false,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      recipient,
      payNative: false,
    });
    assert.equal(v4Sell.to, UNIVERSAL_ROUTER);
    assert.equal(v4Sell.value, 0n);
    assert.equal(v4Sell.data.slice(0, 10), "0x3593564c");
    assert.equal(
      executeCommands(v4Sell.data),
      packCommands([UR_COMMAND_PERMIT2_TRANSFER_FROM, UR_COMMAND_V4_SWAP, UR_COMMAND_UNWRAP_WETH]),
    );
    assert.equal(isErc20TransferCalldata(v4Sell.data), false);
    assert.equal(isTransferToSwapRouter(v4Sell), false);
    assert.doesNotThrow(() => assertSwapNotErc20Transfer(v4Sell));
    assert.equal(
      v4ActionsFromExecute(v4Sell.data),
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE,
        V4_ACTION_TAKE,
      ]),
    );

    const v3Sell = prepareExactInSwap({
      venue: "v3",
      side: "sell",
      token,
      quoteToken: QUOTE_WETH,
      quoteIsWeth: true,
      v3Fee: 100,
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      deadline: 1n,
      recipient,
      payNative: false,
    });
    assert.equal(v3Sell.to, UNIVERSAL_ROUTER);
    assert.equal(
      executeCommands(v3Sell.data),
      packCommands([
        UR_COMMAND_PERMIT2_TRANSFER_FROM,
        UR_COMMAND_V3_SWAP_EXACT_IN,
        UR_COMMAND_UNWRAP_WETH,
      ]),
    );
    assert.equal(isErc20TransferCalldata(v3Sell.data), false);
    assert.doesNotThrow(() => assertSwapNotErc20Transfer(v3Sell));
  });

  it("sells SPACEHOOD through SPCX into ETH, never transfer or pay SPCX", () => {
    const spacehood = "0xfe7e19cbce2f896c6c528bc355baf5a768291e18" as const;
    const spcx = "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea" as const;
    const poolKey = {
      currency0: spcx,
      currency1: spacehood,
      fee: 0x800000,
      tickSpacing: 8,
      hooks: LONG_DOPPLER_HOOK,
    };
    assert.throws(
      () =>
        prepareExactInSwap({
          venue: "v4",
          side: "sell",
          token: spacehood,
          quoteToken: spcx,
          quoteIsNative: false,
          quoteIsWeth: false,
          poolKey,
          zeroForOne: false,
          amountIn: 824215482000000000000n,
          amountOutMinimum: 1n,
          deadline: 1n,
          recipient: "0xb2ae947b9e64aa58c6cbdb136acef4b501fb1202",
          payNative: false,
        }),
      /can't exit to eth/i,
    );

    const tx = prepareExactInSwap({
      venue: "v4",
      side: "sell",
      token: spacehood,
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
      poolKey,
      zeroForOne: false,
      amountIn: 824215482000000000000n,
      amountOutMinimum: 1n,
      deadline: 1n,
      recipient: "0xb2ae947b9e64aa58c6cbdb136acef4b501fb1202",
      payNative: false,
      hops: [
        {
          venue: "v4",
          tokenIn: spacehood,
          tokenOut: spcx,
          poolKey,
          zeroForOne: false,
        },
        {
          venue: "v3",
          tokenIn: spcx,
          tokenOut: QUOTE_WETH,
          v3Fee: 500,
          amountIn: "1000",
        },
      ],
    });
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.data.slice(0, 10), "0x3593564c");
    assert.equal(
      executeCommands(tx.data),
      packCommands([
        UR_COMMAND_PERMIT2_TRANSFER_FROM,
        UR_COMMAND_V4_SWAP,
        UR_COMMAND_V3_SWAP_EXACT_IN,
        UR_COMMAND_UNWRAP_WETH,
      ]),
    );
    assert.notEqual(tx.data.slice(0, 10), ERC20_TRANSFER_SELECTOR);
    assert.equal(isTransferToSwapRouter(tx), false);
    assert.equal(
      v4ActionsFromExecute(tx.data),
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE,
        V4_ACTION_TAKE,
      ]),
    );
    assert.notEqual(
      v4ActionsFromExecute(tx.data),
      packActions([
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_SETTLE_ALL,
        V4_ACTION_TAKE,
      ]),
    );

    const lost = {
      to: spacehood,
      data: encodeTransfer(UNIVERSAL_ROUTER, 824215482000000000000n),
      value: 0n,
    };
    assert.equal(lost.data.slice(0, 10), ERC20_TRANSFER_SELECTOR);
    assert.equal(isTransferToSwapRouter(lost), true);
    assert.throws(() => assertSwapNotErc20Transfer(lost), /swap/i);
    assert.equal(CANT_EXIT_TO_ETH, "Can't exit to ETH");
  });

  it("encodes a stock-paired buy as UR execute from ETH, never transfer", () => {
    const token = "0xf3239df6f081f7c98bc5ba27fb24eea66cd1d69c" as const;
    const spy = "0x117cc2133c37b721f49de2a7a74833232b3b4c0c" as const;
    const hop1 = {
      currency0: QUOTE_WETH,
      currency1: spy,
      fee: 3000,
      tickSpacing: 60,
      hooks: "0x0000000000000000000000000000000000000000" as const,
    };
    const hop2 = {
      currency0: spy,
      currency1: token,
      fee: 0,
      tickSpacing: 200,
      hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as const,
    };
    const tx = prepareExactInSwap({
      venue: "v4",
      side: "buy",
      token,
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
      poolKey: hop2,
      zeroForOne: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 10n ** 16n,
      deadline: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      payNative: true,
      hops: [
        {
          venue: "v4",
          tokenIn: QUOTE_WETH,
          tokenOut: spy,
          poolKey: hop1,
          zeroForOne: true,
        },
        {
          venue: "v4",
          tokenIn: spy,
          tokenOut: token,
          poolKey: hop2,
          zeroForOne: true,
          amountIn: (4n * 10n ** 17n).toString(),
        },
      ],
    });
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.value, 10n ** 16n);
    assert.equal(tx.data.slice(0, 10), "0x3593564c");
    assert.equal(
      executeCommands(tx.data),
      packCommands([UR_COMMAND_WRAP_ETH, UR_COMMAND_V4_SWAP, UR_COMMAND_V4_SWAP]),
    );
    assert.equal(isErc20TransferCalldata(tx.data), false);
    assert.equal(isTransferToSwapRouter(tx), false);
    assert.doesNotThrow(() => assertSwapNotErc20Transfer(tx));
    assert.notEqual(tx.data.slice(0, 10), ERC20_TRANSFER_SELECTOR);
    assert.equal(
      v4ActionsFromExecute(tx.data, 1),
      packActions([
        V4_ACTION_SETTLE,
        V4_ACTION_SWAP_EXACT_IN_SINGLE,
        V4_ACTION_TAKE_ALL,
      ]),
    );
  });

  it("encodes HodlRouter buy() with value, not an ERC-20 transfer", () => {
    const router = "0x50cb78e0034b4869d8d42ad901c614866f5c5e99" as const;
    const token = KEY.currency1;
    const tx = encodeHodlBuy({
      router,
      tokenOut: token,
      minAmountOut: 1n,
      hint: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: token,
        fee: 3000,
        tickSpacing: 0,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      deadline: 1n,
      value: 10n ** 16n,
    });
    assert.equal(tx.to, router);
    assert.equal(tx.value, 10n ** 16n);
    assert.notEqual(tx.to, UNIVERSAL_ROUTER);
    assert.equal(isErc20TransferCalldata(tx.data), false);
    assert.equal(isTransferToSwapRouter(tx), false);
    const decoded = decodeFunctionData({abi: hodlRouterAbi, data: tx.data});
    assert.equal(decoded.functionName, "buy");
  });

  it("encodes HodlRouter sell() rather than a token transfer", () => {
    const router = "0x50cb78e0034b4869d8d42ad901c614866f5c5e99" as const;
    const token = KEY.currency0;
    const tx = encodeHodlSell({
      router,
      tokenIn: token,
      amountIn: 10n ** 16n,
      tokenOut: "0x0000000000000000000000000000000000000000",
      minAmountOut: 1n,
      hint: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: token,
        fee: 3000,
        tickSpacing: 0,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      deadline: 1n,
    });
    assert.equal(tx.to, router);
    assert.notEqual(tx.to, UNIVERSAL_ROUTER);
    assert.equal(isErc20TransferCalldata(tx.data), false);
    assert.equal(isTransferToSwapRouter(tx), false);
    const decoded = decodeFunctionData({abi: hodlRouterAbi, data: tx.data});
    assert.equal(decoded.functionName, "sell");
  });

  it("encodes SwapRouter02 exactInputSingle for the V3 venue", () => {
    const tx = buildV3Swap({
      tokenIn: KEY.currency0,
      tokenOut: KEY.currency1,
      fee: 100,
      recipient: "0x1111111111111111111111111111111111111111",
      amountIn: 10n ** 16n,
      amountOutMinimum: 1n,
      nativeIn: true,
    });
    assert.equal(tx.to, UNISWAP_SWAP_ROUTER_02);
    assert.equal(tx.value, 10n ** 16n);
    assert.equal(tx.data.slice(0, 10), "0x04e45aaf");
  });
});

describe("trade policy", () => {
  it("does not ticket-block an RWA when a Uniswap venue exists", () => {
    assert.equal(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }),
      null,
    );
    assert.equal(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: undefined,
        quotePending: false,
      }),
      null,
      "undefined venue means not quoted yet, not a missing pool",
    );
    assert.match(
      ticketBlockReason({
        kind: "rwa",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
      }) ?? "",
      /no uniswap pool/i,
    );
  });

  it("blocks demo, missing wallet, and a missing venue", () => {
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: true,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }) ?? "",
      /demo/i,
    );
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: null,
        venue: "v4",
        quotePending: false,
      }) ?? "",
      /sign in/i,
    );
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
      }) ?? "",
      /no uniswap pool/i,
    );
    assert.match(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
        quoteError: "Can't exit to ETH",
      }) ?? "",
      /can't exit to eth/i,
    );
    assert.equal(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: null,
        quotePending: false,
        quoteError: "Can't buy with ETH",
      }),
      "Can't buy with ETH",
    );
    assert.equal(quoteMissButtonLabel("Can't buy with ETH"), "Can't buy with ETH");
    assert.equal(quoteMissButtonLabel("Can't exit to ETH"), "Can't exit to ETH");
    assert.equal(quoteMissButtonLabel(ROUTE_NO_LIQUIDITY), "No liquidity");
    assert.equal(quoteMissButtonLabel(LIVE_BUY_OVER_CAP), "Over cap");
    assert.equal(quoteMissButtonLabel(null), "No pool");
    assert.equal(quoteMissReason("Can't buy with ETH"), "Can't buy with ETH");
    assert.equal(quoteMissReason(ROUTE_NO_LIQUIDITY), ROUTE_NO_LIQUIDITY);
    assert.equal(quoteMissReason(LIVE_BUY_OVER_CAP), LIVE_BUY_OVER_CAP);
    assert.match(quoteMissReason(null), /no uniswap pool/i);
    assert.equal(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: "v4",
        quotePending: false,
      }),
      null,
    );
    assert.equal(
      ticketBlockReason({
        kind: "token",
        authenticated: true,
        demo: false,
        wallet: "0x1",
        venue: undefined,
        quotePending: false,
      }),
      null,
      "undefined venue means not quoted yet, not a missing pool",
    );
  });

  it("applies slippage to the quoter output", () => {
    assert.equal(amountOutMinimum(10_000n, 1), 9_900n);
    assert.equal(amountOutMinimum(10_000n, 0), 10_000n);
  });
});

describe("swap quote parse", () => {
  it("rejects a paper-style empty venue", () => {
    const miss = parseSwapQuote({venue: null});
    assert.equal(miss.ok, false);
  });

  it("keeps hop-implied receive USD and impact on the quote", () => {
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "40000000000000000",
      amountOut: "1650000000000000000",
      quoteToken: "0x0000000000000000000000000000000000000000",
      quoteIsNative: true,
      poolKey: KEY,
      zeroForOne: true,
      usdOut: 0.00065,
      priceImpactBps: 10000,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.quote.usdOut, 0.00065);
      assert.equal(parsed.quote.priceImpactBps, 10000);
      assert.notEqual(parsed.quote.usdOut, 100);
    }
  });

  it("keeps the sized amountIn the encoder must use", () => {
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "1000000",
      amountOut: "42",
      quoteToken: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      poolKey: KEY,
      zeroForOne: true,
      venueLabel: "Uniswap V4",
      creatorTax: "none",
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.quote.amountIn, "1000000");
  });

  it("parses a SPACEHOOD sell as ETH out, not SPCX", () => {
    const spacehood = "0xfe7e19cbce2f896c6c528bc355baf5a768291e18";
    const spcx = "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea";
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "824215482000000000000",
      amountOut: "123000000000000000",
      netOut: "122385000000000000",
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
      quoteSymbol: "ETH",
      pairToken: spcx,
      poolKey: {
        currency0: spcx,
        currency1: spacehood,
        fee: 0x800000,
        tickSpacing: 8,
        hooks: LONG_DOPPLER_HOOK,
      },
      hops: [
        {
          venue: "v4",
          tokenIn: spacehood,
          tokenOut: spcx,
          poolKey: {
            currency0: spcx,
            currency1: spacehood,
            fee: 0x800000,
            tickSpacing: 8,
            hooks: LONG_DOPPLER_HOOK,
          },
          zeroForOne: false,
        },
        {venue: "v3", tokenIn: spcx, tokenOut: QUOTE_WETH, v3Fee: 500, amountIn: "1"},
      ],
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.quote.quoteToken, QUOTE_WETH);
      assert.equal(parsed.quote.quoteSymbol, "ETH");
      assert.equal(parsed.quote.quoteIsWeth, true);
      assert.equal(parsed.quote.pairToken, spcx);
      assert.equal(parsed.quote.hops.length, 2);
      assert.equal(parsed.quote.hops[1].tokenOut, QUOTE_WETH);
    }
  });

  it("accepts a V4 quote paired with a tokenized stock, not USDG", () => {
    const ibm = "0x980dcf6766fa79f5cf0c4aadb3ab477ff15a9619";
    const parsed = parseSwapQuote({
      venue: "v4",
      amountIn: "106464526019930160",
      amountOut: "147002329996137738092522",
      quoteToken: ibm,
      quoteIsNative: false,
      quoteIsWeth: false,
      poolKey: {
        currency0: ibm,
        currency1: "0xf2e122a481b440c40eee7a7ca6d5eef65a591b76",
        fee: 0,
        tickSpacing: 200,
        hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.quote.quoteToken, ibm);
      assert.equal(parsed.quote.venue, "v4");
      assert.ok(parsed.quote.poolKey);
    }
  });
});

describe("ETH → stock entry hop", () => {
  it("rejects a dust AMZN hop that would keep pennies of $100 ETH", () => {
    const ethIn = 40207258372147648n;
    const ethBack = 250000000000n; // ~$0.00065 at $2600/ETH
    assert.equal(entryHopTooThin(ethIn, ethBack), true);
    assert.equal(entryHopTooThin(ethIn, 0n), true);
    assert.equal(entryHopTooThin(ethIn, (ethIn * 50n) / 100n), false);
    assert.equal(entryHopTooThin(ethIn, (ethIn * 9n) / 100n), true);
    assert.equal(entryHopTooThin(ethIn, (ethIn * 10n) / 100n), true);
  });
});

describe("PRIMED-shaped UR buy must fail closed", () => {
  const ethIn = 40207258372147648n;
  const dustAmzn = 2491873877779n;
  const primedOut = 1483670225993740225n;
  const amzn = "0x12f190a9f9d7d37a250758b26824b97ce941bf54" as const;
  const primed = "0x0c142d74e591b4b4ff7ddb9d600a75a3637a8179" as const;
  const hop1 = {
    currency0: "0x0000000000000000000000000000000000000000" as const,
    currency1: amzn,
    fee: 10000,
    tickSpacing: 200,
    hooks: "0x0000000000000000000000000000000000000000" as const,
  };
  const hop2 = {
    currency0: primed,
    currency1: amzn,
    fee: 0,
    tickSpacing: 200,
    hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as const,
  };
  const primedHops = [
    {
      venue: "v4" as const,
      tokenIn: "0x0000000000000000000000000000000000000000" as const,
      tokenOut: amzn,
      poolKey: hop1,
      zeroForOne: true,
    },
    {
      venue: "v4" as const,
      tokenIn: amzn,
      tokenOut: primed,
      poolKey: hop2,
      zeroForOne: false,
      amountIn: dustAmzn.toString(),
    },
  ];

  it("refuses dust pair out, missing minOut, and $100 → $0.001 value", () => {
    assert.equal(intermediateOutIsDust(ethIn, dustAmzn), true);
    assert.equal(intermediateOutIsDust(ethIn, 4n * 10n ** 17n), false);
    assert.equal(outputValueTooLow(104, 0.00065), true);
    assert.equal(outputValueTooLow(100, 95), false);
    assert.equal(liveBuyOverCap(104), true);
    assert.equal(liveBuyOverCap(100), false);
    assert.equal(LIVE_BUY_OVER_CAP, "This size is above the current notional cap.");
    assert.throws(() => requireBuyMinOut(ethIn, 0n), /no liquidity/i);
    assert.throws(() => requireBuyMinOut(ethIn, 1n), /no liquidity/i);
    assert.doesNotThrow(() => requireBuyMinOut(ethIn, primedOut));
    assert.throws(
      () =>
        assertSaneUrBuy({
          amountIn: ethIn,
          amountOutMinimum: primedOut,
          hops: primedHops,
        }),
      /no liquidity/i,
    );
    assert.equal(
      refuseUnsafeBuyQuote({
        quote: {
          amountIn: ethIn.toString(),
          amountOut: primedOut.toString(),
          hops: primedHops,
        },
        slippagePct: 1,
        amountUsd: 104,
      }),
      LIVE_BUY_OVER_CAP,
    );
    assert.equal(
      refuseUnsafeBuyQuote({
        quote: {
          amountIn: ethIn.toString(),
          amountOut: primedOut.toString(),
          hops: primedHops,
        },
        slippagePct: 1,
        amountUsd: 100,
      }),
      null,
      "quote-time keeps the ticket so the user sees dust USD + impact",
    );
    assert.equal(priceImpactBps(100, 0.00065), 10000);
    assert.ok(outputValueTooLow(100, 0.00065));
  });

  it("refuses to encode the PRIMED execute even when last-hop minOut looks real", () => {
    assert.throws(
      () =>
        prepareExactInSwap({
          venue: "v4",
          side: "buy",
          token: primed,
          quoteToken: "0x0000000000000000000000000000000000000000",
          quoteIsNative: true,
          quoteIsWeth: false,
          poolKey: hop2,
          zeroForOne: false,
          amountIn: ethIn,
          amountOutMinimum: primedOut,
          deadline: 1n,
          recipient: "0x1111111111111111111111111111111111111111",
          payNative: true,
          hops: primedHops,
        }),
      /no liquidity/i,
    );
    assert.throws(
      () =>
        prepareExactInSwap({
          venue: "v4",
          side: "buy",
          token: primed,
          quoteToken: "0x0000000000000000000000000000000000000000",
          quoteIsNative: true,
          quoteIsWeth: false,
          poolKey: hop2,
          zeroForOne: false,
          amountIn: ethIn,
          amountOutMinimum: 0n,
          deadline: 1n,
          recipient: "0x1111111111111111111111111111111111111111",
          payNative: true,
          hops: [
            primedHops[0],
            {...primedHops[1], amountIn: (4n * 10n ** 17n).toString()},
          ],
        }),
      /no liquidity/i,
    );
  });

  it("still encodes a sane stock-paired buy with a real hop-1 minOut", () => {
    const spy = "0x117cc2133c37b721f49de2a7a74833232b3b4c0c" as const;
    const token = "0xf3239df6f081f7c98bc5ba27fb24eea66cd1d69c" as const;
    const pairOut = 4n * 10n ** 17n;
    const tx = prepareExactInSwap({
      venue: "v4",
      side: "buy",
      token,
      quoteToken: QUOTE_WETH,
      quoteIsNative: false,
      quoteIsWeth: true,
      amountIn: 10n ** 16n,
      amountOutMinimum: 10n ** 16n,
      deadline: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      payNative: true,
      hops: [
        {
          venue: "v4",
          tokenIn: QUOTE_WETH,
          tokenOut: spy,
          poolKey: {
            currency0: QUOTE_WETH,
            currency1: spy,
            fee: 3000,
            tickSpacing: 60,
            hooks: "0x0000000000000000000000000000000000000000",
          },
          zeroForOne: true,
        },
        {
          venue: "v4",
          tokenIn: spy,
          tokenOut: token,
          poolKey: {
            currency0: spy,
            currency1: token,
            fee: 0,
            tickSpacing: 200,
            hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
          },
          zeroForOne: true,
          amountIn: pairOut.toString(),
        },
      ],
    });
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.value, 10n ** 16n);
    const hop0Min = v4SwapField(tx.data, 0, "amountOutMinimum");
    assert.ok(hop0Min > 1n);
    assert.equal(hop0Min, amountOutMinimum(pairOut, 5));
    assert.equal(ROUTE_NO_LIQUIDITY, "This route has no liquidity.");
  });
});
