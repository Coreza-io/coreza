import { expect, test, type Page, type Locator } from "@playwright/test";
const reference = '{{ $("history").json.items }}';
async function point(control: Locator, offset: number) {
  return control.evaluate((element: HTMLInputElement, offset) => {
    const r = element.getBoundingClientRect(), s = getComputedStyle(element), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const scale = r.width / element.offsetWidth;
    return { x: r.left + (parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft) + ctx.measureText(element.value.slice(0, offset)).width - element.scrollLeft) * scale, y: r.top + r.height / 2 };
  }, offset);
}
async function drop(page: Page, target: Locator, offset: number, sourceId = "history") {
  const p = await point(target, offset);
  await target.evaluate((element, { p, sourceId }) => {
    const transfer = new DataTransfer();
    transfer.setData("application/reactflow", JSON.stringify({ type: "jsonReference", sourceNodeId: sourceId, pathSegments: ["items"] }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: p.x, clientY: p.y }));
  }, { p, sourceId });
}

test.beforeEach(async ({ page }) => { await page.goto("/tests/browser/fixtures/reference-drop.html"); });

test("inserts generic references at pointer start, middle and end, once per bubbling drop", async ({ page }) => {
  const control = page.locator("#generic input");
  for (const offset of [0,3,6]) {
    await page.evaluate(() => (window as any).fixtureSetGeneric("abcdef"));
    await expect(control).toHaveValue("abcdef");
    await drop(page, control, offset);
    await expect(control).toHaveValue("abcdef".slice(0, offset) + reference + "abcdef".slice(offset));
    await expect(control).toBeFocused();
  }
});

test("typed mode swap restores the mounted textarea and keeps typing/drop undo units", async ({ page }) => {
  const input = page.locator("#typed input"), textarea = page.locator("#typed textarea");
  await input.click(); await input.press("End"); await input.pressSequentially("x");
  await expect(input).toHaveValue("abcdefx");
  await drop(page, input, 3);
  await expect(textarea).toHaveValue(`abc${reference}defx`); await expect(textarea).toBeFocused();
  expect(await textarea.evaluate((control: HTMLTextAreaElement) => control.selectionStart)).toBe(3 + reference.length);
  await textarea.press("Control+z"); await expect(input).toHaveValue("abcdefx"); await expect(page.locator("#mode")).toHaveText("fixed");
  await input.press("Control+z"); await expect(input).toHaveValue("abcdef");
  await input.press("Control+Shift+z"); await expect(input).toHaveValue("abcdefx");
  await input.press("Control+Shift+z"); await expect(textarea).toHaveValue(`abc${reference}defx`);
});

test("selection replacement uses half-open pointer containment and survives blur", async ({ page }) => {
  const control = page.locator("#generic input");
  for (const [offset, expected] of [[2, `a${reference}ef`], [4, `abcd${reference}ef`], [0, `${reference}abcdef`]] as const) {
    await page.evaluate(() => (window as any).fixtureSetGeneric("abcdef")); await expect(control).toHaveValue("abcdef");
    await control.focus(); await control.evaluate((el: HTMLInputElement) => { el.setSelectionRange(1,4); el.dispatchEvent(new Event("select", { bubbles: true })); });
    await page.locator("#source").click();
    await drop(page, control, offset); await expect(control).toHaveValue(expected);
  }
});

test("geometry respects zoom, wrapping, trailing newline, scrolling and grapheme boundaries", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle zoom" }).click();
  const input = page.locator("#typed input"); await drop(page, input, 3);
  const textarea = page.locator("#typed textarea"); await expect(textarea).toHaveValue(`abc${reference}def`);
  await page.evaluate(() => (window as any).fixtureSetTyped({ value: "012345678901234567890123456789\n\t💹é\n", mode: "expression" }));
  await expect(textarea).toHaveValue("012345678901234567890123456789\n\t💹é\n");
  const result = await textarea.evaluate((el: HTMLTextAreaElement) => {
    const r = el.getBoundingClientRect();
    return Array.from({ length: 30 }, (_, i) => (window as any).fixtureCaret(el, r.left + 20 + i * 8, r.bottom - 22)?.offset);
  });
  expect(result.every(offset => offset !== 33 && offset !== 35)).toBe(true);
  expect(result).toContain(37);
});

test("rejects stale sources, code strings, invalid geometry and disabled mutations", async ({ page }) => {
  const input = page.locator("#typed input"); await drop(page, input, 3, "deleted"); await expect(input).toHaveValue("abcdef");
  await page.evaluate(() => (window as any).fixtureSetTyped({ value: '{{ "abc" }}', mode: "expression" }));
  const textarea = page.locator("#typed textarea");
  // First text line is at the padded top, not the textarea's vertical middle.
  await textarea.evaluate(el => {
    const r = el.getBoundingClientRect(), transfer = new DataTransfer(); transfer.setData("application/reactflow", JSON.stringify({ type: "jsonReference", sourceNodeId: "history", pathSegments: ["items"] }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: r.left + 65, clientY: r.top + 24 }));
  });
  await expect(textarea).toHaveValue('{{ "abc" }}');
  await page.getByRole("button", { name: "Toggle disabled" }).click(); await drop(page, textarea, 0); await expect(textarea).toHaveValue('{{ "abc" }}');
});

test("handles a physical drag and clears its hover caret without changing selection", async ({ page }) => {
  const input = page.locator("#generic input");
  const p = await point(input, 3), box = (await input.boundingBox())!;
  await page.locator("#source").dragTo(input, { targetPosition: { x: p.x - box.x, y: p.y - box.y } });
  await expect(input).toHaveValue(`abc${reference}def`);
  await expect(page.locator("[data-reference-caret]")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore document" }).click();
  const restored = page.locator("#typed input");
  await restored.focus(); await restored.press("Control+z"); await expect(restored).toHaveValue("restored");
});

test("measures wrapped text after vertical scrolling with the native scrollbar width", async ({ page }) => {
  await page.evaluate(() => (window as any).fixtureSetTyped({ value: "a".repeat(200), mode: "expression" }));
  const textarea = page.locator("#typed textarea");
  await expect(textarea).toHaveValue("a".repeat(200));
  const result = await textarea.evaluate((el: HTMLTextAreaElement) => {
    const s = getComputedStyle(el), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!; ctx.font = `${s.fontSize} ${s.fontFamily}`;
    const columns = Math.floor((el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)) / ctx.measureText("a").width);
    el.scrollTop = 48;
    const r = el.getBoundingClientRect();
    const position = (window as any).fixtureCaret(el, r.left + 15, r.top + 25);
    const lineEnd = (window as any).fixtureCaret(el, r.right - 15, r.top + 25);
    return { actual: position.offset, expected: columns * 2, end: lineEnd.offset, expectedEnd: columns * 3 };
  });
  expect(result.actual).toBe(result.expected);
  expect(result.end).toBe(result.expectedEnd);
});

test("ordinary number edits and undo do not call unsupported selection APIs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const input = page.locator("#number input");
  await input.fill("13"); await expect(input).toHaveValue("13");
  await input.press("Control+z"); await expect(input).toHaveValue("12");
  await input.press("Control+Shift+z"); await expect(input).toHaveValue("13");
  expect(errors).toEqual([]);
});

test("a blocked typed restore keeps its undo entry available", async ({ page }) => {
  const input = page.locator("#typed input"), textarea = page.locator("#typed textarea");
  await drop(page, input, 3); await expect(textarea).toHaveValue(`abc${reference}def`);
  await page.getByRole("button", { name: "Toggle restore guard" }).click();
  await textarea.press("Control+z"); await expect(textarea).toHaveValue(`abc${reference}def`);
  await page.getByRole("button", { name: "Toggle restore guard" }).click();
  await textarea.press("Control+z"); await expect(input).toHaveValue("abcdef");
  await input.press("Control+Shift+z"); await expect(textarea).toHaveValue(`abc${reference}def`);
});

test("native beforeinput history is routed through the field transaction once", async ({ page }) => {
  const input = page.locator("#typed input"), textarea = page.locator("#typed textarea");
  await drop(page, input, 3); await expect(textarea).toHaveValue(`abc${reference}def`);
  const cancelled = await textarea.evaluate(control => !control.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" })));
  expect(cancelled).toBe(true); await expect(input).toHaveValue("abcdef");
  await input.evaluate(control => control.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyRedo" })));
  await expect(textarea).toHaveValue(`abc${reference}def`);
});

test("generic blank normalization preserves history and skips whitespace no-op edits", async ({ page }) => {
  const input = page.locator("#normalized input");
  await input.fill("changed");
  await input.fill("");
  await input.press("Space"); await expect(input).toHaveValue("");
  await input.press("Control+z"); await expect(input).toHaveValue("changed");
  await input.press("Control+z"); await expect(input).toHaveValue("original");
  await input.press("Control+Shift+z"); await expect(input).toHaveValue("changed");
  await input.press("Control+Shift+z"); await expect(input).toHaveValue("");
  await input.press("Space"); await expect(input).toHaveValue("");
  await input.press("Control+z"); await expect(input).toHaveValue("changed");
  await input.press("Control+z"); await expect(input).toHaveValue("original");
});

test("owners without blank normalization preserve whitespace and its history", async ({ page }) => {
  for (const selector of ["#typed input", "#generic input"]) {
    const input = page.locator(selector);
    await input.fill(" "); await expect(input).toHaveValue(" ");
    await input.press("Control+z"); await expect(input).toHaveValue("abcdef");
    await input.press("Control+Shift+z"); await expect(input).toHaveValue(" ");
  }
});
