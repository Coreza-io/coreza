import { expect, test } from "@playwright/test";

interface FrameSample {
  compactVisible: boolean;
  memberVisibility: string;
  surfaceVisibility: string;
  surfaceTransitionProperty: string;
  surfaceTransitionDuration: string;
  activeAnimations: number;
  hostTransform: string;
  surfaceRect: Pick<DOMRect, "x" | "y" | "width" | "height">;
  boundaryEdgePath: string | null;
}

test("collapsed members are hidden in the first painted frame without a visibility transition", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/cluster-collapse.html");
  const member = page.locator('.react-flow__node[data-id="backtest-init"]');
  await expect(member.locator("[data-node-surface]")).toBeVisible();

  const samples = await page.evaluate(async (): Promise<FrameSample[]> => {
    const initialSurface = document.querySelector<HTMLElement>('.react-flow__node[data-id="backtest-init"] [data-node-surface]');
    if (!initialSurface) throw new Error("Expected the initial member node surface");
    const visibilityTransitions: string[] = [];
    initialSurface.addEventListener("transitionrun", (event) => {
      if (event.propertyName === "visibility") visibilityTransitions.push(event.propertyName);
    });
    document.querySelector<HTMLButtonElement>("#collapse-cluster")?.click();
    const captured: FrameSample[] = [];
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const host = document.querySelector<HTMLElement>('.react-flow__node[data-id="backtest-init"]');
      const surface = host?.querySelector<HTMLElement>("[data-node-surface]");
      const compact = document.querySelector<HTMLElement>(".cluster-card");
      if (!host || !surface) throw new Error("Expected the mounted member runtime host and node surface");
      const hostStyle = getComputedStyle(host);
      const surfaceStyle = getComputedStyle(surface);
      const rect = surface.getBoundingClientRect();
      captured.push({
        compactVisible: compact !== null && getComputedStyle(compact).visibility === "visible",
        memberVisibility: hostStyle.visibility,
        surfaceVisibility: surfaceStyle.visibility,
        surfaceTransitionProperty: surfaceStyle.transitionProperty,
        surfaceTransitionDuration: surfaceStyle.transitionDuration,
        activeAnimations: surface.getAnimations().length,
        hostTransform: hostStyle.transform,
        surfaceRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        boundaryEdgePath: document.querySelector<SVGPathElement>('.react-flow__edge[data-id="boundary"] path')?.getAttribute("d") ?? null,
      });
    }
    if (visibilityTransitions.length > 0) throw new Error("The hidden node surface started a visibility transition");
    return captured;
  });

  expect(samples.some(({ compactVisible }) => compactVisible)).toBe(true);
  for (const sample of samples.filter(({ compactVisible }) => compactVisible)) {
    expect(sample).toMatchObject({
      memberVisibility: "hidden",
      surfaceVisibility: "hidden",
      surfaceTransitionProperty: "none",
      surfaceTransitionDuration: "0s",
      activeAnimations: 0,
    });
  }
});

test("compact cluster execution is revealed only by cluster hover or keyboard focus", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/cluster-collapse.html");
  await page.locator("#collapse-cluster").click();

  const cluster = page.locator(".cluster-card");
  const action = cluster.locator("[data-cluster-execution-control]");
  const execute = cluster.getByRole("button", { name: "Execute cluster Strategy" });
  await expect(cluster).toBeVisible();
  await expect(action).toHaveCSS("opacity", "0");

  await cluster.hover();
  await expect(action).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(action).toHaveCSS("opacity", "0");

  await execute.focus();
  await expect(execute).toBeFocused();
  await expect(action).toHaveCSS("opacity", "1");
});
