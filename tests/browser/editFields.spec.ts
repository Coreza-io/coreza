import { expect, test } from "@playwright/test";

const source = '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}';
const repaired = '{{ lastN($("get_atr_history").json.data.value, $("short_len").json.data) }}';

test("the actual editor offers the screenshot repair and previews the native array", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/edit-fields.html");
  const textarea = page.locator("textarea");
  await expect(textarea).toHaveValue(source);
  await expect(page.getByText(/Bracket access requires/)).toBeVisible();
  await expect(page.getByText("Dynamic slice bounds are unsupported. Use lastN for a dynamic suffix:")).toBeVisible();
  // The suggestion leaves the original expression intact until the user applies it.
  await expect(textarea).toHaveValue(source);
  await page.getByRole("button", { name: "Apply lastN repair" }).click();
  await expect(textarea).toHaveValue(repaired);
  await expect(page.getByText("[4,5,6,7,8]", { exact: true })).toBeVisible();
  await expect(page.getByText("· Array", { exact: true })).toBeVisible();
  await expect(page.getByText(/Bracket access requires/)).toHaveCount(0);
});

test("the editor keeps repairs capability-gated and does not rewrite fixed values", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/edit-fields.html?unsupported");
  await expect(page.getByText(/Bracket access requires/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply lastN repair" })).toHaveCount(0);
  await page.goto("/tests/browser/fixtures/edit-fields.html");
  await expect(page.getByRole("button", { name: "Apply lastN repair" })).toBeVisible();
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await expect(page.locator("textarea")).toHaveValue(source);
  await expect(page.getByRole("button", { name: "Apply lastN repair" })).toHaveCount(0);
});
