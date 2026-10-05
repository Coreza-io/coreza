import { expect, test } from "@playwright/test";

test("isolates one cluster, preserves runtime owners, and shares execution behavior", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/cluster-focus.html");
  await expect(page.locator(".cluster-card")).toHaveCount(4);
  await expect(page.locator('[data-member-id="store"]')).toBeHidden();

  const alphaCard = page.locator(".cluster-card").filter({ hasText: "Alpha strategy" });
  await alphaCard.hover();
  await alphaCard.getByRole("button", { name: "Execute cluster Alpha strategy" }).click();
  await expect(page.locator('[data-executions="alpha"]')).toHaveText("1");

  await page.getByRole("button", { name: "Focus alpha" }).click();
  await expect(page.locator('[data-focused-frame="alpha"]')).toBeVisible();
  await expect(page.locator(".cluster-card")).toHaveCount(0);
  await expect(page.locator('.react-flow__node:not([style*="visibility: hidden"])')).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Execute cluster Alpha strategy" })).toHaveText("Execute");
  await page.getByRole("button", { name: "Execute cluster Alpha strategy" }).click();
  await expect(page.locator('[data-executions="alpha"]')).toHaveText("2");

  await page.getByRole("button", { name: "Focus beta" }).click();
  await expect(page.locator('[data-focused-frame="beta"]')).toBeVisible();
  await expect(page.locator('[data-member-id="alpha-loop"]')).toBeHidden();
  await expect(page.locator('[data-member-id="beta-loop"]')).toBeVisible();

  await page.getByRole("button", { name: "Close focus" }).click();
  await expect(page.locator(".cluster-card")).toHaveCount(4);
  expect(await page.evaluate(() => window.clusterMounts)).toEqual({
    store: 1,
    "alpha-loop": 1,
    "alpha-branch": 1,
    "beta-loop": 1,
    "beta-branch": 1,
    "gamma-loop": 1,
    "gamma-branch": 1,
    "delta-loop": 1,
    "delta-branch": 1,
  });
});
