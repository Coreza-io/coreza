import { expect, test } from "@playwright/test";
const source = '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}';
test.beforeEach(async ({ page }) => { await page.goto("/tests/browser/fixtures/edit-fields.html"); });

test("the screenshot expression resolves directly and observes the latest count", async ({ page }) => {
  await expect(page.locator("textarea")).toHaveValue(source);
  await expect(page.getByText("[4,5,6,7,8]", { exact: true })).toBeVisible();
  await expect(page.getByText("· Array", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /repair/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Set zero count" }).click();
  await expect(page.getByText("[1,2,3,4,5,6,7,8]", { exact: true })).toBeVisible();
});

test("nested bounds resolve without rewriting text and participate in undo/redo", async ({ page }) => {
  const textarea = page.locator("textarea");
  const nested = '{{ $("get_atr_history").json.data.value[-{{ $("short_len").json.data }}:] }}';
  await textarea.fill(nested);
  await expect(page.getByText("[4,5,6,7,8]", { exact: true })).toBeVisible();
  await expect(textarea).toHaveValue(nested);
  await textarea.press("Control+z"); await expect(textarea).toHaveValue(source);
  await textarea.press("Control+Shift+z"); await expect(textarea).toHaveValue(nested);
  await expect(page.getByText('Value Mode', { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fixed", exact: true })).toHaveCount(0);
  await textarea.fill('[10,20]');
  await expect(page.getByText('[10,20]', { exact: true })).toBeVisible();
});

test("retired saved calls stay editable and report an explicit conversion diagnostic", async ({ page }) => {
  const value = '{{ lastN($("get_atr_history").json.data.value, $("short_len").json.data) }}';
  await page.locator("textarea").fill(value);
  await expect(page.getByText(/lastN has been removed; use array\[-count:\]/)).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue(value);
  await page.locator("textarea").fill(source);
  await expect(page.getByText("[4,5,6,7,8]", { exact: true })).toBeVisible();
});
