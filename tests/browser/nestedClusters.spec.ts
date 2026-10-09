import { expect, test } from "@playwright/test";
test("navigates two levels, moves effective leaves once, and preserves runtime mounts", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/nested-clusters.html");
  await expect(page.locator(".cluster-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Expand cluster Outer" }).click();
  await expect(page.locator('[data-frame="Outer"]')).toBeVisible();
  await expect(page.locator('[data-member="c"]')).toBeVisible();
  await page.getByRole("button", { name: "Expand cluster Inner" }).click();
  await expect(page.locator("[data-frame]")).toHaveCount(2);
  await expect(page.locator('[data-member="a"]')).toBeVisible();
  const before = await page.evaluate(() => window.nestedPositions);
  const childHeader = await page.locator('[data-drag="Inner"]').boundingBox();
  if (!childHeader) throw new Error("Expected child header");
  await page.mouse.move(childHeader.x + 10, childHeader.y + 10);
  await page.mouse.down();
  await page.mouse.move(childHeader.x + 52, childHeader.y + 31, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.nestedPositions);
  expect(after.a.x - before.a.x).toBeCloseTo(60);
  expect(after.b.x - before.b.x).toBeCloseTo(60);
  expect(after.c).toEqual(before.c);
  const parentHeader = await page.locator('[data-drag="Outer"]').boundingBox();
  if (!parentHeader) throw new Error("Expected parent header");
  await page.mouse.move(parentHeader.x + 10, parentHeader.y + 10);
  await page.mouse.down();
  await page.mouse.move(parentHeader.x + 31, parentHeader.y + 31, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.nestedPositions);
  for (const id of ["a", "b", "c"])
    expect(moved[id].x - after[id].x).toBeCloseTo(30);
  await page.locator('[data-close="Inner"]').click();
  await expect(page.locator("[data-frame]")).toHaveCount(1);
  await expect(page.locator(".cluster-card")).toHaveCount(1);
  await page.locator('[data-close="Outer"]').click();
  await expect(page.locator("[data-frame]")).toHaveCount(0);
  await expect(page.locator(".cluster-card")).toHaveCount(1);
  expect(await page.evaluate(() => window.nestedMounts)).toEqual({
    a: 1,
    b: 1,
    c: 1,
  });
});
