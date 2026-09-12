import { compileEditTemplate } from "../../coreza-backend/src/nodes/logic/editTemplate";

export interface ReferenceInsertion {
  value: string;
  caret: number;
}

export function insertEditFieldReference(
  value: string,
  reference: string,
  selectionStart?: number,
  selectionEnd?: number,
): ReferenceInsertion | null {
  const compiledReference = compileEditTemplate(reference);
  const referenceCode = compiledReference.segments.find(
    (segment) => segment.kind === "code",
  );
  if (!referenceCode || referenceCode.kind !== "code") return null;

  const hasSelection =
    typeof selectionStart === "number" &&
    typeof selectionEnd === "number" &&
    Number.isInteger(selectionStart) &&
    Number.isInteger(selectionEnd) &&
    selectionStart >= 0 &&
    selectionEnd >= selectionStart &&
    selectionEnd <= value.length;
  const start = hasSelection ? selectionStart : value.length;
  const end = hasSelection ? selectionEnd : start;
  let insideCode = false;
  try {
    const compiled = compileEditTemplate(value);
    insideCode = compiled.segments.some(
      (segment) =>
        segment.kind === "code" &&
        start >= segment.expressionStart &&
        start <= segment.end - 2,
    );
  } catch {
    // An unfinished value is still a valid authoring state.
  }
  const inserted = insideCode ? referenceCode.value : reference;
  const caret = start + inserted.length;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    caret,
  };
}
