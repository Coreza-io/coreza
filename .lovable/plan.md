## Re-confirmed against attached guide (v2)
The second PDF is identical to the first. The existing plan already covers every section: §3 target colors, §4 file responsibilities, §5 full `NodeVisualTheme` token shape, §6 exact-name resolver, §7 BaseNode integration, §8 NodeWrapper background/border/glow + CSS variables, §9 two glass reflection overlays, §10 AI yellow `A` badge + category iconModes, §11 edge tuning (Option B with `sourceTheme.edgeColor` + glow), §12 circular ports using `--node-border-color`/`--node-glow-color`, §13 step order, §14 QA checklist.

No additions required — proceeding with the previously approved plan below.

---

## Step 1 — `src/components/nodes/constants/nodeVisualThemes.ts` (new)
Exact token shape from the doc:
```ts
export type NodeVisualCategory = "action" | "utility" | "indicator" | "logic" | "output";
export interface NodeVisualTheme {
  neon: string; border: string; glow: string; background: string;
  titleColor: string;
  iconMode: "ai-badge" | "toolbox" | "indicator" | "branch" | "chart";
  edgeColor: string;
}
```
Use the document’s exact hex values for action/utility/indicator/logic/output (purple/teal/cobalt/amber/maroon).

## Step 2 — `resolveNodeVisualCategory.ts` (new)
Exact node-name mapping first (Buy/Sell/Place Order/getBrokerBalance/getBrokerPosition/Alpaca/AlpacaStreamListener → action; getPortfolio/createPortfolio/updatePortfolioValue/getPosition/getOpenOrders/Register Buy Order/Register Sell Order/Asset Registry → utility; RSI/EMA/Bollinger Bands/Volume Oscillator → indicator; underValued/If Undervalued/noPosition/noOpenOrder/isLongPosition/portfolioNotExist/switch → logic; Visualize/Performance → output), then broad-category fallback per §6.

## Step 3 — `BaseNode.tsx`
Resolve `visualCategory` + `nodeTheme`, expose both on render props, keep `neonColor = nodeTheme.neon` for back-compat.

## Step 4 — `NodeRouter.tsx`
Pass `nodeTheme={renderProps.nodeTheme}` and `category={renderProps.visualCategory}` to NodeWrapper.

## Step 5 — `NodeWrapper.tsx`
Dark-mode card style sourced entirely from `nodeTheme`:
- CSS vars: `--node-neon-color`, `--node-border-color`, `--node-glow-color`, `--node-title-color`
- `background: theme.background`
- `border: 1.5px solid ${theme.border}`
- `boxShadow`: inner highlight + inner shadow + outer rim + 18px + 46px glow rings
- `selected` → `brightness(1.16)` only (no blue ring)

## Step 6 — Two glass reflection overlays in `NodeWrapper`
Inside `<Card>`, before handles/content, dark-mode only:
1. Diagonal: `linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06) 18%, transparent 44%)`, `mix-blend-mode: screen`, opacity 0.7
2. Top radial: `radial-gradient(circle at 50% -20%, rgba(255,255,255,0.10), transparent 42%)`
Both `pointer-events-none`, `absolute inset-0 rounded-lg`. Ensure handles/content z-index sits above.

## Step 7 — `BasicNodeLayout.tsx` icon modes
- `iconMode === "ai-badge"`: yellow rounded-square tile with bold black `A`, soft yellow glow
- Other modes: glass tile using `color-mix(in srgb, var(--node-neon-color) 12%, transparent)` background, `var(--node-border-color)` ring, `var(--node-glow-color)` shadow
- Title uses `var(--node-title-color, #fff)` in dark mode (white, not neon)

Collapsed view (`NodeWrapper.tsx`): big icon + white bold title + 2-line description, matching reference card.

## Step 8 — `EdgeManager.tsx` (doc Option B)
Replace `CATEGORY_NEON_COLORS` lookup with resolver:
```ts
const sourceTheme = NODE_VISUAL_THEMES[resolveNodeVisualCategory(sourceDef)];
const cordColor = sourceTheme.edgeColor ?? "#22d3ee";
const glowColor = sourceTheme.glow;
```
Cord 2px, glow 10–12px @ ~0.5 opacity, endpoint dots in `cordColor`, branch labels light/readable.

## Step 9 — `index.css` port styling
Dark `.plug-handle::after` uses:
```css
border-color: var(--node-border-color);
box-shadow: 0 0 10px var(--node-glow-color);
background: var(--node-neon-color);
```

## Step 10 — Light mode untouched
All theme-driven styling gated on `isDarkMode`.

## Step 11 — QA checklist (from doc §14)
Per-category body gradients distinct; AI nodes show yellow `A`; utility teal; indicator cobalt; logic amber; output maroon; selected/executing don’t overpower; collapsed + expanded both show glass/reflection; edges connect cleanly; light mode unaffected.

## Files
- new: `src/components/nodes/constants/nodeVisualThemes.ts`
- new: `src/components/nodes/constants/resolveNodeVisualCategory.ts`
- modify: `src/components/nodes/BaseNode.tsx`, `NodeRouter.tsx`, `src/utils/NodeWrapper.tsx`, `src/components/nodes/layout/BasicNodeLayout.tsx`, `src/components/workflow/EdgeManager.tsx`, `src/index.css`
- `src/components/nodes/constants/neonColors.ts` kept only as a thin re-export wrapper for any remaining callers.