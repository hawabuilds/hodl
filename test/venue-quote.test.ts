import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  amountOutFromQuoter,
  feeOnAmount,
  inputAfterBuyFee,
  netAfterPlatformFee,
  pickBestVenue,
  venueTicketCopy,
} from "../src/lib/venueQuote";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;

describe("venue quote", () => {
  it("takes 50 bps off the quoter output", () => {
    assert.equal(netAfterPlatformFee(10_000n), 9_950n);
  });

  it("picks the venue with the higher net, even when that is V3", () => {
    const best = pickBestVenue([
      {
        venue: "v4",
        amountOut: 1000n,
        creatorTaxBps: 200,
        quoteToken: WETH,
        label: "v4",
      },
      {
        venue: "v3",
        amountOut: 1100n,
        creatorTaxBps: 0,
        quoteToken: WETH,
        label: "v3",
      },
    ]);
    assert.equal(best?.venue, "v3");
    assert.equal(best?.creatorTaxBps, 0);
    assert.equal(best?.netOut, netAfterPlatformFee(1100n));
    assert.equal(best?.feeAmount, 1100n * 50n / 10_000n);
  });

  it("does not subtract stated creator tax a second time", () => {
    const quoted = 10_000n;
    const statedBps = 500;
    const once = amountOutFromQuoter(quoted, statedBps);
    assert.equal(once, quoted);
    const doubleCounted = quoted - (quoted * BigInt(statedBps)) / 10_000n;
    assert.notEqual(once, doubleCounted);
    const best = pickBestVenue([
      {
        venue: "v4",
        amountOut: quoted,
        creatorTaxBps: statedBps,
        quoteToken: WETH,
        label: "v4",
      },
    ]);
    assert.equal(best?.amountOut, quoted);
    assert.equal(best?.netOut, netAfterPlatformFee(quoted));
    assert.equal(best?.feeAmount, quoted * 50n / 10_000n);
  });

  it("quote path source never re-applies creator tax bps", () => {
    const files = [
      "src/lib/venueQuote.ts",
      "src/lib/server/live/venueResolve.ts",
      "src/app/api/quote/route.ts",
    ];
    const taxReapply =
      /amountOut\s*\*\s*\(?\s*10_?000n?\s*-\s*.*Tax|creatorTaxBps\)\s*\/\s*10_?000|stated.*bps.*amountOut/i;
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.equal(taxReapply.test(src), false, `${file} re-applies stated tax`);
    }
  });

  it("keeps V4 when nets are equal", () => {
    const best = pickBestVenue([
      {
        venue: "v4",
        amountOut: 1000n,
        creatorTaxBps: 200,
        quoteToken: WETH,
        label: "v4",
      },
      {
        venue: "v3",
        amountOut: 1000n,
        creatorTaxBps: 0,
        quoteToken: WETH,
        label: "v3",
      },
    ]);
    assert.equal(best?.venue, "v4");
    assert.equal(
      venueTicketCopy(best!).creatorTax,
      "2.00% creator tax on this route",
    );
  });

  it("leaves the full output when the path takes no platform fee", () => {
    const best = pickBestVenue(
      [
        {
          venue: "v4",
          amountOut: 10_000n,
          creatorTaxBps: 0,
          quoteToken: WETH,
          label: "v4",
        },
      ],
      0,
      true,
      10_000n,
    );
    assert.equal(best?.platformFeeBps, 0);
    assert.equal(best?.feeAmount, 0n);
    assert.equal(best?.netOut, 10_000n);
  });

  it("buy quotes the post-fee input so the ticket matches Trade", () => {
    const amountIn = 1_000_000n;
    assert.equal(inputAfterBuyFee(amountIn), 995_000n);
    assert.equal(feeOnAmount(amountIn), 5_000n);
    const best = pickBestVenue(
      [
        {
          venue: "v4",
          amountOut: 42_000n,
          creatorTaxBps: 100,
          quoteToken: WETH,
          label: "v4",
        },
      ],
      50,
      false,
      amountIn,
    );
    assert.equal(best?.netOut, 42_000n);
    assert.equal(best?.feeAmount, 5_000n);
  });
});
