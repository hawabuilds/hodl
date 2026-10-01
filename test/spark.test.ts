import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {anchorDayLine, encodeSpark, SPARK_SCALE, sparkChangePct} from "../src/lib/spark.ts";
import {onGrid} from "../src/lib/server/live/sparkBuilder.ts";

describe("mini charts", () => {
  it("encodes the shape 0–999 and keeps the ends", () => {
    const v = encodeSpark([2, 1, 4, 3]);
    assert.equal(v.length, 4);
    assert.equal(Math.min(...v), 0);
    assert.equal(Math.max(...v), SPARK_SCALE);
    assert.equal(v[1], 0);
    assert.equal(v[2], SPARK_SCALE);
  });

  it("draws a level line mid-height when nothing moved", () => {
    assert.deepEqual(encodeSpark([5, 5, 5]), [500, 500, 500]);
    assert.deepEqual(encodeSpark([5]), [500, 500]);
  });

  it("the % is the line's own first-to-last move", () => {
    assert.equal(sparkChangePct([100, 120, 73]).toFixed(2), "-27.00");
    assert.equal(sparkChangePct([1]), 0);
  });

  it("a stock's day line ends exactly the day's % above or below its start", () => {
    const line = anchorDayLine([101, 99, 104], 110, 10);
    assert.equal(line[0].toFixed(6), "100.000000");
    assert.equal(line[line.length - 1], 110);
    assert.equal(sparkChangePct(line).toFixed(2), "10.00");
  });

  it("fills a time grid forward from the last print", () => {
    const t0 = 1_000_000;
    const grid = onGrid([{t: t0, price: 1}, {t: t0 + 120_000, price: 2}], t0, t0 + 180_000, 60_000);
    assert.deepEqual(grid, [1, 1, 2, 2]);
  });
});
