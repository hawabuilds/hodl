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
import {CANT_EXIT_TO_ETH} from "../src/lib/swapRoute";
import {amountOutMinimum, ticketBlockReason} from "../src/lib/tradePolicy";
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
} from "../src/lib/swapTx";

const urAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

function executeCommands(data: `0x${string}`): string {
  const decoded = decodeFunctionData({abi: urAbi, data});
  return String(decoded.args[0]);
}

function v4ActionsFromExecute(data: `0x${string}`): string {
  const decoded = decodeFunctionData({abi: urAbi, data});
  const commands = String(decoded.args[0]).slice(2);
  const bytes: string[] = commands.match(/.{2}/g) ?? [];
  const index = bytes.indexOf(UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0"));
  const input = decoded.args[1][index] as `0x${string}`;
  const [actions] = decodeAbiParameters(
    [{type: "bytes"}, {type: "bytes[]"}],
    input,
  );
  return actions;
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
      amountOutMinimum: 1n,
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
          amountIn: "1000",
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
