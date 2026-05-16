import { describe, expect, test } from "@jest/globals";
import {
  alignSeriesToCandles,
  classifyOverlay,
  extractBars,
  normalizeTime,
} from "@/utils/visualizeNormalize";

const candles = [
  { time: 1, open: 10, high: 12, low: 9, close: 11 },
  { time: 2, open: 11, high: 13, low: 10, close: 12 },
  { time: 3, open: 12, high: 14, low: 11, close: 13 },
];

describe("visualizeNormalize", () => {
  test("normalizeTime handles sec, ms, numeric string, and ISO", () => {
    expect(normalizeTime(1710000000)).toBe(1710000000);
    expect(normalizeTime(1710000000000)).toBe(1710000000);
    expect(normalizeTime("1710000000000")).toBe(1710000000);
    expect(normalizeTime("2024-03-09T00:00:00Z")).toBe(1709942400);
  });

  test("extractBars handles bar arrays and dict-of-arrays", () => {
    expect(
      extractBars([{ t: 1710000000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]),
    ).toHaveLength(1);

    expect(
      extractBars({
        time: [1710000000],
        open: [1],
        high: [2],
        low: [0.5],
        close: [1.5],
        volume: [10],
      }),
    ).toHaveLength(1);
  });

  test("alignSeriesToCandles right-aligns raw arrays and time-joins objects", () => {
    const rightAligned = alignSeriesToCandles(candles, [10, 20]);
    expect(rightAligned.map((point) => point.value)).toEqual([null, 10, 20]);

    const joined = alignSeriesToCandles(candles, [
      { time: 1, value: 100 },
      { time: 3, value: 300 },
    ]);
    expect(joined.map((point) => point.value)).toEqual([100, null, 300]);
  });

  test("classifyOverlay honors order bands -> levels -> panel -> line", () => {
    expect(classifyOverlay("BB", "Auto", { upper: [1], lower: [0] }, candles).kind).toBe(
      "bands",
    );

    expect(
      classifyOverlay(
        "S/R",
        "Auto",
        [{ type: "support", level: 10 }, { type: "resistance", level: 15 }],
        candles,
      ).kind,
    ).toBe("levels");

    expect(classifyOverlay("RSI", "Auto", [50, 51], candles).kind).toBe("panel");
    expect(classifyOverlay("EMA", "Auto", [11, 12, 13], candles).kind).toBe("line");
  });
});
