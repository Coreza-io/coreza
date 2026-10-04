import { expect, test } from "@playwright/test";

test("switches between hover Play and in-flow Execute without selecting or expanding on activation", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/node-execution-controls.html");
  const node = page.locator('.react-flow__node[data-id="executable"]');
  const surface = node.locator("[data-node-surface]");
  const play = node.getByRole("button", { name: "Execute node Compute" });
  const actionBand = node.locator("[data-collapsed-execution-control]");

  await expect(node).not.toHaveClass(/selected/);
  await expect(actionBand).toHaveCSS("opacity", "0");
  await surface.hover();
  await expect(actionBand).toHaveCSS("opacity", "1");
  await play.press("Enter");
  await expect(node.locator('[data-execution-count="executable"]')).toHaveText("1");
  await expect(node.locator(".node-expanded")).toHaveCount(0);

  await surface.dblclick({ position: { x: 20, y: 20 } });
  await expect(node.getByRole("button", { name: "Collapse" })).toBeVisible();
  await expect(node.getByRole("button", { name: "Execute node Compute" })).toHaveText("Execute");
  await expect(node.getByLabel("Compute value")).toHaveValue("preserved");
  await expect(node.getByRole("button", { name: "Execute node Compute" })).toHaveCount(1);
});

test("reveals the collapsed control on keyboard focus and omits controls in read-only nodes", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/node-execution-controls.html");
  const executable = page.locator('.react-flow__node[data-id="executable"]');
  const play = executable.getByRole("button", { name: "Execute node Compute" });
  const actionBand = executable.locator("[data-collapsed-execution-control]");
  await play.focus();
  await expect(play).toBeFocused();
  await expect(actionBand).toHaveCSS("opacity", "1");
  await play.press("Space");
  await expect(executable.locator('[data-execution-count="executable"]')).toHaveText("1");

  const readOnly = page.locator('.react-flow__node[data-id="read-only"]');
  await expect(readOnly.getByRole("button", { name: /Execute node/ })).toHaveCount(0);
});
