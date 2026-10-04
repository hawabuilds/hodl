import {afterEach, describe, it} from "node:test";
import assert from "node:assert/strict";
import {decodeAbiParameters, decodeFunctionData, parseAbi} from "viem";
import {FEE_COLLECTOR, QUOTE_ETH, QUOTE_USDG, QUOTE_WETH, UNIVERSAL_ROUTER} from "../src/lib/contracts";
import {fetchSwapQuote, tradeCurrency, type SwapQuote} from "../src/lib/swapQuote";
import type {SwapHop} from "../src/lib/swapRoute";
import {
  buildBuyFromToken,
  buildSellToEth,
  prepareExactInSwap,
  UR_COMMAND_PAY_PORTION,
  UR_COMMAND_PERMIT2_TRANSFER_FROM,
  UR_COMMAND_SWEEP,
  UR_COMMAND_TRANSFER,
  UR_COMMAND_UNWRAP_WETH,
  UR_COMMAND_V3_SWAP_EXACT_IN,
  UR_COMMAND_WRAP_ETH,
  UR_CONTRACT_BALANCE,
} from "../src/lib/swapTx";
import {intermediateOutIsDust, requireBuyMinOut, ROUTE_NO_LIQUIDITY} from "../src/lib/tradePolicy";
import {buyAvailableLabel, buyPaysNative, sellReceiveLabel, usdgShortfall} from "../src/lib/tradeTicket";
import {UR_ADDRESS_THIS, UR_COMMAND_V4_SWAP, UR_MSG_SENDER} from "../src/lib/v4Encoding";
import {hodlCanExecuteQuote} from "../src/lib/liveTrade";

const urAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

function decodeExecute(data: `0x${string}`): {commands: number[]; inputs: readonly `0x${string}`[]} {
  const decoded = decodeFunctionData({abi: urAbi, data});
  const hex = String(decoded.args[0]).slice(2);
  return {
    commands: (hex.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)),
    inputs: decoded.args[1] as readonly `0x${string}`[],
  };
}

const three = [{type: "address"}, {type: "address"}, {type: "uint256"}] as const;
const two = [{type: "address"}, {type: "uint256"}] as const;

const ORBIO = "0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3" as const;
const FIG = "0x41f4267525a8aff329540ef24fd83d9044758b33" as const;
const SETTLE = "0x986c2f2f7881cc1767a22919a6543f9ce291e62c" as const;
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" as const;
const USER = "0x00000000000000000000000000000000000000a1" as const;

const usdgToWeth: SwapHop = {venue: "v3", tokenIn: QUOTE_USDG, tokenOut: QUOTE_WETH, v3Fee: 100, amountIn: "24875000"};
const wethToOrbio: SwapHop = {venue: "v3", tokenIn: QUOTE_WETH, tokenOut: ORBIO, v3Fee: 10000, amountIn: "9000000000000000"};
const orbioToWeth: SwapHop = {venue: "v3", tokenIn: ORBIO, tokenOut: QUOTE_WETH, v3Fee: 10000};
const wethToUsdg: SwapHop = {venue: "v3", tokenIn: QUOTE_WETH, tokenOut: QUOTE_USDG, v3Fee: 100};
const settlePool = {currency0: QUOTE_ETH, currency1: SETTLE, fee: 0, tickSpacing: 200, hooks: PONS_HOOK};
const settleToEth: SwapHop = {venue: "v4", tokenIn: SETTLE, tokenOut: QUOTE_ETH, poolKey: settlePool, zeroForOne: false};
const ethToSettle: SwapHop = {venue: "v4", tokenIn: QUOTE_ETH, tokenOut: SETTLE, poolKey: settlePool, zeroForOne: true, amountIn: "9000000000000000"};

function swapBuild(over: Partial<Parameters<typeof prepareExactInSwap>[0]>) {
  return {
    venue: "v3" as const,
    side: "buy" as const,
    token: ORBIO,
    quoteToken: QUOTE_USDG,
    amountIn: 25_000_000n,
    amountOutMinimum: 10n ** 18n,
    deadline: 2_000_000_000n,
    recipient: USER,
    payNative: false,
    ...over,
  };
}

describe("USD-paid buys through the Universal Router", () => {
  it("pulls USDG via Permit2, sends exactly 50 bps to FeeCollector, then swaps the rest", () => {
    const tx = buildBuyFromToken(swapBuild({hops: [usdgToWeth, wethToOrbio]}));
    assert.equal(tx.to, UNIVERSAL_ROUTER);
    assert.equal(tx.value, 0n, "no ETH attached");
    const {commands, inputs} = decodeExecute(tx.data);
    assert.deepEqual(commands, [
      UR_COMMAND_PERMIT2_TRANSFER_FROM,
      UR_COMMAND_TRANSFER,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_V3_SWAP_EXACT_IN,
    ]);
    const [pullToken, pullTo, pullAmount] = decodeAbiParameters(
      [{type: "address"}, {type: "address"}, {type: "uint160"}],
      inputs[0],
    );
    assert.equal(pullToken.toLowerCase(), QUOTE_USDG);
    assert.equal(pullTo.toLowerCase(), UNIVERSAL_ROUTER);
    assert.equal(pullAmount, 25_000_000n);
    const [feeToken, feeTo, fee] = decodeAbiParameters(three, inputs[1]);
    assert.equal(feeToken.toLowerCase(), QUOTE_USDG);
    assert.equal(feeTo.toLowerCase(), FEE_COLLECTOR);
    assert.equal(fee, 125_000n, "0.5% of 25 USDG");
    const hop1 = decodeAbiParameters(
      [{type: "address"}, {type: "uint256"}, {type: "uint256"}, {type: "bytes"}, {type: "bool"}, {type: "uint256[]"}],
      inputs[2],
    );
    assert.equal(hop1[0].toLowerCase(), UR_ADDRESS_THIS, "first hop keeps WETH on the router");
    assert.equal(hop1[1], 25_000_000n - 125_000n, "fee + swap = input");
    assert.equal(hop1[4], false, "spends the router's USDG, not the user's");
    const hop2 = decodeAbiParameters(
      [{type: "address"}, {type: "uint256"}, {type: "uint256"}, {type: "bytes"}, {type: "bool"}, {type: "uint256[]"}],
      inputs[3],
    );
    assert.equal(hop2[0].toLowerCase(), UR_MSG_SENDER, "the token goes to the buyer");
    assert.equal(hop2[1], UR_CONTRACT_BALANCE);
    assert.equal(hop2[2], 10n ** 18n, "minimum on the last hop");
  });

  it("prepareExactInSwap sends a non-native buy down the token path", () => {
    const tx = prepareExactInSwap(swapBuild({hops: [usdgToWeth, wethToOrbio]}));
    assert.equal(decodeExecute(tx.data).commands[0], UR_COMMAND_PERMIT2_TRANSFER_FROM);
    assert.equal(tx.value, 0n);
  });

  it("unwraps between hops when the token's pool is native ETH (USDG → WETH → ETH pool)", () => {
    const tx = buildBuyFromToken(swapBuild({token: SETTLE, hops: [usdgToWeth, ethToSettle]}));
    const {commands, inputs} = decodeExecute(tx.data);
    assert.deepEqual(commands, [
      UR_COMMAND_PERMIT2_TRANSFER_FROM,
      UR_COMMAND_TRANSFER,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_UNWRAP_WETH,
      UR_COMMAND_V4_SWAP,
    ]);
    const [to, min] = decodeAbiParameters(two, inputs[3]);
    assert.equal(to.toLowerCase(), UR_ADDRESS_THIS, "ETH stays on the router for the V4 hop");
    assert.equal(min, 0n);
  });

  it("refuses an ETH first hop on the token path", () => {
    assert.throws(() => buildBuyFromToken(swapBuild({hops: [ethToSettle]})), /pays ETH/);
  });

  it("keeps the dust guard, in USDG units", () => {
    // $25 in, almost nothing out of hop 1: refuse before signing.
    assert.throws(
      () => buildBuyFromToken(swapBuild({hops: [usdgToWeth, {...wethToOrbio, amountIn: "10"}]})),
      new RegExp(ROUTE_NO_LIQUIDITY),
    );
    assert.throws(() => requireBuyMinOut(25_000_000n, 1n, QUOTE_USDG), new RegExp(ROUTE_NO_LIQUIDITY));
    assert.doesNotThrow(() => requireBuyMinOut(500_000n, 1n, QUOTE_USDG), "under $1 stays quiet");
  });

  it("does not mistake a real USDG mid-hop for dust on an ETH-paid buy (ETH → USDG → FIG)", () => {
    const ethIn = 10n ** 16n;
    assert.equal(intermediateOutIsDust(ethIn, 26_000_000n, {payToken: QUOTE_WETH, pairToken: QUOTE_USDG}), false);
    assert.equal(intermediateOutIsDust(ethIn, 50n, {payToken: QUOTE_WETH, pairToken: QUOTE_USDG}), true);
    const tx = prepareExactInSwap(
      swapBuild({
        token: FIG,
        quoteToken: QUOTE_WETH,
        payNative: true,
        amountIn: ethIn,
        hops: [
          {venue: "v3", tokenIn: QUOTE_WETH, tokenOut: QUOTE_USDG, v3Fee: 100},
          {venue: "v3", tokenIn: QUOTE_USDG, tokenOut: FIG, v3Fee: 3000, amountIn: "26000000"},
        ],
      }),
    );
    assert.equal(tx.value, ethIn);
    assert.equal(decodeExecute(tx.data).commands[0], UR_COMMAND_WRAP_ETH);
  });
});

describe("USD-received sells through the Universal Router", () => {
  it("pays 50 bps of the USDG out to FeeCollector and sweeps the rest to the seller", () => {
    const tx = buildSellToEth(
      swapBuild({side: "sell", amountIn: 18n * 10n ** 18n, amountOutMinimum: 1_000_000n, hops: [orbioToWeth, wethToUsdg]}),
    );
    const {commands, inputs} = decodeExecute(tx.data);
    assert.deepEqual(commands, [
      UR_COMMAND_PERMIT2_TRANSFER_FROM,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_PAY_PORTION,
      UR_COMMAND_SWEEP,
    ]);
    const [feeToken, feeTo, bips] = decodeAbiParameters(three, inputs[3]);
    assert.equal(feeToken.toLowerCase(), QUOTE_USDG);
    assert.equal(feeTo.toLowerCase(), FEE_COLLECTOR);
    assert.equal(bips, 50n);
    const [sweepToken, sweepTo, sweepMin] = decodeAbiParameters(three, inputs[4]);
    assert.equal(sweepToken.toLowerCase(), QUOTE_USDG);
    assert.equal(sweepTo.toLowerCase(), UR_MSG_SENDER);
    assert.equal(sweepMin, 1_000_000n - 5_000n, "minimum is the seller's share after the fee");
  });

  it("wraps between hops when the token's pool pays native ETH (SETTLE → ETH → USDG)", () => {
    const tx = buildSellToEth(swapBuild({side: "sell", token: SETTLE, amountIn: 10n ** 20n, amountOutMinimum: 1_000_000n, hops: [settleToEth, wethToUsdg]}));
    const {commands, inputs} = decodeExecute(tx.data);
    assert.deepEqual(commands, [
      UR_COMMAND_PERMIT2_TRANSFER_FROM,
      UR_COMMAND_V4_SWAP,
      UR_COMMAND_WRAP_ETH,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_PAY_PORTION,
      UR_COMMAND_SWEEP,
    ]);
    const [to, amount] = decodeAbiParameters(two, inputs[2]);
    assert.equal(to.toLowerCase(), UR_ADDRESS_THIS);
    assert.equal(amount, UR_CONTRACT_BALANCE, "wraps everything the V4 hop paid out");
  });

  it("still exits to ETH exactly as before", () => {
    const tx = buildSellToEth(swapBuild({side: "sell", amountIn: 10n ** 18n, amountOutMinimum: 10n ** 15n, hops: [orbioToWeth]}));
    const {commands} = decodeExecute(tx.data);
    assert.deepEqual(commands, [
      UR_COMMAND_PERMIT2_TRANSFER_FROM,
      UR_COMMAND_V3_SWAP_EXACT_IN,
      UR_COMMAND_PAY_PORTION,
      UR_COMMAND_UNWRAP_WETH,
    ]);
  });
});

function quote(over: Partial<SwapQuote>): SwapQuote {
  return {
    venue: "v3",
    venueLabel: "Uniswap V3",
    creatorTax: "",
    creatorTaxBps: 0,
    amountIn: "0",
    amountOut: "0",
    netOut: "0",
    feeAmount: "0",
    feeToken: null,
    feeBps: 50,
    lpFee: "",
    lpFeeBps: null,
    quoteToken: QUOTE_USDG,
    tokenDecimals: 18,
    quoteDecimals: 6,
    outDecimals: 6,
    zeroForOne: false,
    quoteIsNative: false,
    quoteIsWeth: false,
    quoteSymbol: "USDG",
    poolKey: null,
    v3Fee: 3000,
    v3Pool: null,
    pairToken: null,
    hops: [],
    ...over,
  };
}

describe("router or direct path", () => {
  it("a single-hop USDG buy or sell goes through HodlRouter", () => {
    assert.equal(hodlCanExecuteQuote(quote({pairToken: QUOTE_USDG}), "buy"), true);
    assert.equal(hodlCanExecuteQuote(quote({pairToken: QUOTE_USDG}), "sell"), true);
    assert.equal(buyPaysNative(quote({})), false, "a USDG buy is not paid in ETH");
  });

  it("a two-hop USD route goes direct, and is not paid in ETH", () => {
    const usdBuy = quote({hops: [usdgToWeth, wethToOrbio], pairToken: QUOTE_WETH});
    assert.equal(hodlCanExecuteQuote(usdBuy, "buy"), false);
    assert.equal(buyPaysNative(usdBuy), false);
  });

  it("an ETH-paid buy of a USDG-only token goes direct and is paid in ETH", () => {
    const ethBuy = quote({
      quoteToken: QUOTE_WETH,
      quoteIsWeth: true,
      hops: [{venue: "v3", tokenIn: QUOTE_WETH, tokenOut: QUOTE_USDG, v3Fee: 100}, {venue: "v3", tokenIn: QUOTE_USDG, tokenOut: FIG, v3Fee: 3000}],
      pairToken: QUOTE_USDG,
    });
    assert.equal(hodlCanExecuteQuote(ethBuy, "buy"), false);
    assert.equal(buyPaysNative(ethBuy), true);
  });
});

describe("ticket copy", () => {
  it("Available shows the paying currency with its name", () => {
    assert.equal(buyAvailableLabel({payEth: false, ethUnits: 0.0097, usdgUnits: 48.2}), "$48.20 USDG");
    assert.equal(buyAvailableLabel({payEth: true, ethUnits: 0.0097, usdgUnits: 48.2}), "0.0097 ETH");
    assert.equal(buyAvailableLabel({payEth: false, ethUnits: 1, usdgUnits: null}), "—");
    assert.equal(buyAvailableLabel({payEth: false, ethUnits: 1, usdgUnits: 0}), "$0.00 USDG");
  });

  it("You receive is after the fee, in the chosen currency", () => {
    assert.equal(
      sellReceiveLabel(quote({amountOut: "12230000", netOut: "12168850"})),
      "≈ $12.17 USDG",
    );
    assert.equal(
      sellReceiveLabel(quote({quoteToken: QUOTE_WETH, quoteIsWeth: true, quoteSymbol: "ETH", outDecimals: 18, amountOut: "4522000000000000", netOut: "4499390000000000"})),
      "≈ 0.0045 ETH",
    );
  });

  it("Not enough USDG only when paying USD and the balance is short", () => {
    assert.equal(usdgShortfall({payEth: false, enteredUsd: 25, usdgRaw: 0n}), true);
    assert.equal(usdgShortfall({payEth: false, enteredUsd: 25, usdgRaw: 24_999_999n}), true);
    assert.equal(usdgShortfall({payEth: false, enteredUsd: 25, usdgRaw: 25_000_000n}), false, "exactly enough is enough");
    assert.equal(usdgShortfall({payEth: true, enteredUsd: 25, usdgRaw: 0n}), false, "paying ETH ignores USDG");
    assert.equal(usdgShortfall({payEth: false, enteredUsd: 25, usdgRaw: null}), false, "balance not loaded yet");
    assert.equal(usdgShortfall({payEth: false, enteredUsd: Number.NaN, usdgRaw: 0n}), false, "nothing entered");
  });

  it("the toggle maps to the API currency", () => {
    assert.equal(tradeCurrency("USD"), "usdg");
    assert.equal(tradeCurrency("ETH"), "eth");
  });
});

describe("quote requests carry the currency", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  for (const [side, param] of [["buy", "pay"], ["sell", "receive"]] as const) {
    it(`a ${side} sends ${param}=`, async () => {
      let seen = "";
      globalThis.fetch = (async (input: string | URL | Request) => {
        seen = String(input);
        return new Response(JSON.stringify({venue: null}));
      }) as typeof fetch;
      await fetchSwapQuote({token: ORBIO, side, amountIn: 10n, currency: "usdg"});
      const params = new URL(seen, "http://x").searchParams;
      assert.equal(params.get(param), "usdg");
      assert.equal(params.get(param === "pay" ? "receive" : "pay"), null);
    });
  }

  it("omitting the currency keeps the old request", async () => {
    let seen = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen = String(input);
      return new Response(JSON.stringify({venue: null}));
    }) as typeof fetch;
    await fetchSwapQuote({token: ORBIO, side: "buy", amountUsd: 5});
    const params = new URL(seen, "http://x").searchParams;
    assert.equal(params.get("pay"), null);
    assert.equal(params.get("receive"), null);
  });
});
