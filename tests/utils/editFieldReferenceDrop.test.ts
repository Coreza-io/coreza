import { describe, expect, it } from "vitest";
import { insertEditFieldReference } from "../../src/utils/editFieldReferenceDrop";

const reference = '{{ $("window").json.data[0].high }}';

describe("Edit Fields reference insertion", () => {
  it("inserts into empty and non-empty fixed values", () => {
    expect(insertEditFieldReference("", reference)).toEqual({
      value: reference,
      caret: reference.length,
    });
    expect(insertEditFieldReference("prefix", reference)).toEqual({
      value: `prefix${reference}`,
      caret: `prefix${reference}`.length,
    });
  });

  it("replaces a selected range and restores the caret after the reference", () => {
    expect(
      insertEditFieldReference("before high after", reference, 7, 11),
    ).toEqual({
      value: `before ${reference} after`,
      caret: 7 + reference.length,
    });
  });

  it("uses bare expression code only inside a complete expression", () => {
    expect(
      insertEditFieldReference("{{ high > 20 }}", reference, 3, 7),
    ).toEqual({
      value: '{{ $("window").json.data[0].high > 20 }}',
      caret: 3 + '$("window").json.data[0].high'.length,
    });
  });

  it("inserts raw selectors in unambiguous unfinished code", () => {
    expect(insertEditFieldReference("{{ high >", reference, 3, 7)).toEqual({
      value: '{{ $("window").json.data[0].high >',
      caret: 3 + '$("window").json.data[0].high'.length,
    });
  });

  it("rejects selections outside the current value", () => {
    expect(insertEditFieldReference("fixed", reference, 99, 100)).toBeNull();
  });
});
