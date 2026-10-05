import { expect, test } from "@playwright/test";

test("isolates one cluster, preserves runtime owners, and shares execution behavior", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/cluster-focus.html");
  await expect(page.locator(".cluster-card")).toHaveCount(4);
  await expect(page.locator('[data-member-id="store"]')).toBeVisible();

  const alphaCard = page.locator(".cluster-card").filter({ hasText: "Alpha strategy" });
  await alphaCard.hover();
  await alphaCard.getByRole("button", { name: "Execute cluster Alpha strategy" }).click();
  await expect(page.locator('[data-executions="alpha"]')).toHaveText("1");

  await page.getByRole("button", { name: "Focus alpha" }).click();
  await expect(page.locator('[data-focused-frame="alpha"]')).toBeVisible();
  await expect(page.locator(".cluster-card:visible")).toHaveCount(2);
  await expect(page.locator(".cluster-card").filter({ hasText: "Beta strategy" })).toBeHidden();
  await expect(page.locator(".cluster-card").filter({ hasText: "Gamma strategy" })).toBeVisible();
  await expect(page.locator('[data-member-id="store"]')).toBeVisible();
  await expect(page.locator('[data-member-id="outside-overlap"]')).toBeHidden();
  await expect(page.locator('[data-member-id="alpha-loop"]')).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id="feed-alpha"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Execute cluster Alpha strategy" })).toHaveText("Execute");
  await page.getByRole("button", { name: "Execute cluster Alpha strategy" }).click();
  await expect(page.locator('[data-executions="alpha"]')).toHaveText("2");

  await page.getByRole("button", { name: "Move outsider away" }).click();
  await expect(page.locator('[data-member-id="outside-overlap"]')).toBeVisible();

  await page.getByRole("button", { name: "Close focus" }).click();
  await expect(page.locator(".cluster-card")).toHaveCount(4);
  expect(await page.evaluate(() => window.clusterMounts)).toEqual({
    store: 1,
    "outside-overlap": 1,
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
