import { RollingWindow } from "../src/engine/RollingWindow";
import {
  buildRollingWindowPayload,
  clampWindowSize,
  normalizeSymbol,
  normalizeTimeframe,
  parseCandleData,
  ROLLING_WINDOW_ERRORS,
} from "../src/engine/rollingWindowHelpers";

describe("rolling window helpers", () => {
  it("normalizes keys and clamps window sizes", () => {
    expect(normalizeSymbol(" btcusdt ")).toBe("BTCUSDT");
    expect(normalizeTimeframe(" 1h ")).toBe("1h");
    expect(clampWindowSize(undefined)).toBe(20);
    expect(clampWindowSize(0)).toBe(20);
    expect(clampWindowSize(-5)).toBe(1);
    expect(clampWindowSize(501)).toBe(500);
  });

  it.each([
    ["an array", [{ close: 1 }], [{ close: 1 }]],
    ["an object", { close: 2 }, [{ close: 2 }]],
    ["a JSON array", '[{"close":3}]', [{ close: 3 }]],
    ["a JSON value", "null", [null]],
  ])("parses %s", (_description, raw, expected) => {
    expect(parseCandleData(raw)).toEqual({ ok: true, bars: expected });
  });

  it.each([
    [
      "{{ upstream.data }}",
      ROLLING_WINDOW_ERRORS.unresolvedTemplate,
    ],
    ["not-json", ROLLING_WINDOW_ERRORS.invalidCandleData],
    [[], ROLLING_WINDOW_ERRORS.noBars],
    [undefined, ROLLING_WINDOW_ERRORS.noBars],
  ])("returns the contract error for invalid input %#", (raw, error) => {
    expect(parseCandleData(raw)).toEqual({ ok: false, error });
  });

  it("builds complete payloads with copied window values", () => {
    const window = new RollingWindow<unknown>(2);
    window.add({ close: 1 });

    const payload = buildRollingWindowPayload(window);
    expect(payload).toEqual({
      window: [{ close: 1 }],
      count: 1,
      size: 2,
      isReady: false,
      remaining: 1,
      latest: { close: 1 },
      found: true,
    });
    expect(payload.window).not.toBe(window.values());

    expect(buildRollingWindowPayload(undefined)).toEqual({
      window: [],
      count: 0,
      size: 0,
      isReady: false,
      remaining: 0,
      latest: null,
      found: false,
    });
  });
});
