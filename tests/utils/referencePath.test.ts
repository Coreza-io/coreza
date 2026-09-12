import { describe, expect, it } from "vitest";
import {
  createJsonReferenceDragPayload,
  formatPath,
  parseJsonReferenceDragPayload,
  parseLegacyPath,
} from "../../src/utils/referencePath";
import { resolveReferences } from "../../src/utils/resolveReferences";

describe("reference paths", () => {
  it("preserves array indexes and arbitrary object keys", () => {
    const segments = ["data", 0, "timestamp", "01", "a.b", 'a"b', "a\\b"];
    expect(formatPath(segments)).toBe(
      '.data[0].timestamp["01"]["a.b"]["a\\\"b"]["a\\\\b"]',
    );
  });

  it("reads the legacy dotted-array form", () => {
    expect(parseLegacyPath("data.[0].timestamp")).toEqual([
      "data",
      0,
      "timestamp",
    ]);
  });

  it("parses escaped legacy keys containing closing brackets", () => {
    expect(parseLegacyPath('data["a]b\\\"c"].value')).toEqual([
      "data",
      'a]b"c',
      "value",
    ]);
  });

  it("keeps stored references with a dotted array index readable", () => {
    expect(
      resolveReferences(
        '{{ $("window").json.data.[0].timestamp }}',
        {},
        { window: { json: { data: [{ timestamp: "2026-09-12" }] } } },
        [{ id: "window", data: { displayName: "window" } }],
      ),
    ).toBe("2026-09-12");
  });

  it("retains structured segments and source identity in the final drag payload", () => {
    expect(
      createJsonReferenceDragPayload(["data", 0, "high"], "window", "27"),
    ).toEqual({
      type: "jsonReference",
      keyPath: "data[0].high",
      pathSegments: ["data", 0, "high"],
      sourceNodeId: "window",
      value: "27",
    });
  });

  it("validates structured and legacy reference payloads", () => {
    expect(
      parseJsonReferenceDragPayload(
        JSON.stringify({
          type: "jsonReference",
          keyPath: "data.[0].high",
          sourceNodeId: "window",
          value: "27",
        }),
      ),
    ).toEqual({
      type: "jsonReference",
      keyPath: "data[0].high",
      pathSegments: ["data", 0, "high"],
      sourceNodeId: "window",
      value: "27",
    });
    expect(parseJsonReferenceDragPayload('{"type":"node"}')).toBeNull();
    expect(parseJsonReferenceDragPayload("not JSON")).toBeNull();
  });
});
