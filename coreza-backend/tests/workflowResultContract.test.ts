import { createNodeOutcomes } from "../src/engine/types/executionError";

describe("workflow result completeness contract", () => {
  it("accounts for every submitted member without treating falsy results as missing", () => {
    expect(createNodeOutcomes(
      ["zero", "false", "null", "branch"],
      { zero: 0, false: false, null: null },
      "skipped",
    )).toEqual({
      zero: "executed",
      false: "executed",
      null: "executed",
      branch: "skipped",
    });
  });

  it("marks unavailable members according to the terminal cause", () => {
    expect(createNodeOutcomes(["completed", "remaining"], { completed: {} }, "cancelled"))
      .toEqual({ completed: "executed", remaining: "cancelled" });
    expect(createNodeOutcomes(["completed", "remaining"], { completed: {} }, "not-executed"))
      .toEqual({ completed: "executed", remaining: "not-executed" });
  });
});
