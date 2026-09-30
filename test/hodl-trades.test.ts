import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {fillUsd, readFill, type ReceiptLog} from "../src/lib/server/hodlTrades";
import {QUOTE_USDG, QUOTE_WETH} from "../src/lib/contracts";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WITHDRAWAL = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
const WALLET = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x4444444444444444444444444444444444444444";

const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const transfer = (token: string, from: string, to: string, value: bigint): ReceiptLog => ({
  address: token,
  topics: [TRANSFER, topic(from), topic(to)],
  data: word(value),
});

describe("reading a HODL fill from its receipt", () => {
  it("reads a USDG buy: tokens in, dollars out", () => {
    const legs = readFill({
      wallet: WALLET,
      asset: TOKEN,
      value: 0n,
      logs: [
        transfer(QUOTE_USDG, WALLET, POOL, 500_000_000n),
        transfer(TOKEN, POOL, WALLET, 10n ** 21n),
      ],
    });
    assert.equal(legs?.side, "buy");
    assert.equal(legs?.tokenRaw, 10n ** 21n);
    assert.equal(fillUsd(legs!, null), 500);
  });

  it("reads a sell paid out in native ETH through a WETH unwrap", () => {
    const legs = readFill({
      wallet: WALLET,
      asset: TOKEN,
      value: 0n,
      logs: [
        transfer(TOKEN, WALLET, POOL, 5n * 10n ** 18n),
        transfer(QUOTE_WETH, POOL, ROUTER, 2n * 10n ** 17n),
        {address: QUOTE_WETH, topics: [WITHDRAWAL, topic(ROUTER)], data: word(2n * 10n ** 17n)},
      ],
    });
    assert.equal(legs?.side, "sell");
    assert.equal(legs?.ethRaw, 2n * 10n ** 17n);
    assert.equal(fillUsd(legs!, 4_000), 800);
  });

  it("counts native ETH sent with a buy", () => {
    const legs = readFill({
      wallet: WALLET,
      asset: TOKEN,
      value: 10n ** 17n,
      logs: [transfer(TOKEN, POOL, WALLET, 1n)],
    });
    assert.equal(legs?.ethRaw, 10n ** 17n);
  });

  it("is not a trade when the asset never moved for this wallet", () => {
    assert.equal(
      readFill({
        wallet: WALLET,
        asset: TOKEN,
        value: 0n,
        logs: [transfer(TOKEN, POOL, ROUTER, 1n)],
      }),
      null,
    );
  });

  it("leaves the size unknown rather than guessing an ETH price", () => {
    const legs = readFill({
      wallet: WALLET,
      asset: TOKEN,
      value: 10n ** 18n,
      logs: [transfer(TOKEN, POOL, WALLET, 1n)],
    });
    assert.equal(fillUsd(legs!, null), null);
  });
});
