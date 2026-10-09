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
    d: 1,
    e: 1,
  });
});

test("creates and reconnects edges through a collapsed inner boundary using canonical endpoints", async ({page}) => {
  await page.goto("/tests/browser/fixtures/nested-clusters.html");
  await page.getByRole("button",{name:"Expand cluster Outer"}).click();
  const boundary = page.locator('.cluster-card .react-flow__handle[data-handleid="out:bc"]');
  await expect(boundary).toHaveClass(/\bconnectable\b/);
  const drag = async (from: ReturnType<typeof page.locator>, to: ReturnType<typeof page.locator>) => {
    const start=await from.boundingBox();
    const end=await to.boundingBox();
    if (!start || !end) throw new Error("Expected visible boundary and target");
    await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
    await page.mouse.down();
    await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:10});
    await page.mouse.up();
  };
  await drag(page.locator('.react-flow__edge[data-id="bc"] .react-flow__edgeupdater-target'),page.locator('.react-flow__node[data-id="d"] .react-flow__handle.target'));
  await expect.poll(()=>page.evaluate(()=>window.nestedEdges.find(edge=>edge.id==="bc")?.target)).toBe("d");
  await drag(boundary,page.locator('.react-flow__node[data-id="e"] .react-flow__handle.target'));
  await expect.poll(()=>page.evaluate(()=>window.nestedEdges.some(edge=>edge.source==="b" && edge.target==="e"))).toBe(true);
  const canonical=await page.evaluate(()=>window.nestedEdges);
  expect(canonical.find(edge=>edge.id==="bc")).toMatchObject({id:"bc",source:"b",target:"d"});
  expect(canonical.some(edge=>edge.source.startsWith("__coreza") || edge.target.startsWith("__coreza"))).toBe(false);
});
