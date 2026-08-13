import {
  DEFAULT_WARMUP_PERIOD,
  parseWarmupPeriod,
} from "../src/utils/warmupPeriod";

describe("parseWarmupPeriod", () => {
  it.each([undefined, null, ""])("uses the default for %p", (value) => {
    expect(parseWarmupPeriod(value)).toBe(DEFAULT_WARMUP_PERIOD);
  });

  it.each([
    [0, 0],
    ["0", 0],
    ["25", 25],
    [-5, 0],
    ["invalid", 0],
  ])("parses %p as %p", (value, expected) => {
    expect(parseWarmupPeriod(value)).toBe(expected);
  });
});
