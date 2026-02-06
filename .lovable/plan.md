
Goal
- In the Market Data Subscriptions page, show only the raw stream string in the UI (example: `btcusdt@kline_1m`).
- When the user hovers the stream badge, show a small popup box with all related details (source, symbol, event type, interval, environment, scope, and workflow info).
- Fix why hover is currently not working.

What I found in your current implementation (from code review)
1) HoverCard is implemented correctly and already uses a Portal
- `src/components/ui/hover-card.tsx` correctly wraps `HoverCardContent` in `<HoverCardPrimitive.Portal>`, so clipping/overflow should not be the main issue anymore.

2) The most likely reason hover does not open / position correctly: Badge does not forward refs
- `StreamBadgeWithTooltip` uses:
  - `<HoverCardTrigger asChild> ... <Badge> ... </Badge> </HoverCardTrigger>`
- But `src/components/ui/badge.tsx` is a plain function component and does not forward `ref`.
- Radix HoverCard relies on a trigger element ref for positioning; when the child can’t accept the ref, Radix often fails to compute the anchor and the hovercard won’t appear or will appear at a wrong position.
- This is a classic Radix “asChild + non-forwardRef component” issue.

3) “Still showing all info here”
- Your `StreamBadgeWithTooltip` itself only renders `{stream}` inside the badge (good).
- The extra “binance_market → workflowName” row in the Workflow-Scoped section is coming from `MarketSubscriptions.tsx` (not from the badge).
- If you truly want “only the stream string visible”, we must hide/minimize those extra labels and move them into the hover popup.

Plan to fix everything (hover + compact display)

A) Fix HoverCard not working (core fix)
Files:
- src/components/ui/badge.tsx

Changes:
1) Convert `Badge` to `React.forwardRef` so Radix `asChild` can attach a ref to the trigger.
2) Keep API the same so it doesn’t break existing usage.

Implementation sketch:
- Replace:
  - `function Badge(...) { return <div ... /> }`
- With:
  - `const Badge = React.forwardRef<HTMLDivElement, BadgeProps>((props, ref) => <div ref={ref} ... />)`
  - set `Badge.displayName = "Badge"`

Why this should immediately fix hover:
- `HoverCardTrigger` will finally be able to anchor the popover correctly and open on hover.

Optional hardening (recommended even after forwardRef):
- src/components/market/StreamBadgeWithTooltip.tsx
- Change trigger child from `<Badge>` to a native element:
  - Use `<HoverCardTrigger asChild><div className={badgeVariants(...)} ... /></HoverCardTrigger>`
- This guarantees Radix compatibility even if Badge changes again later.
- We can do either (forwardRef Badge) or both (best reliability).

B) Ensure the UI shows only the stream string (move “source → workflow” into hover)
Files:
- src/pages/MarketSubscriptions.tsx
- src/components/market/StreamBadgeWithTooltip.tsx

Workflow-Scoped Subscriptions section (the screenshot you shared)
Current:
- Each workflow-scoped block shows:
  - Source badge + arrow + workflow link
  - Stream badge(s)
Desired:
- Only show stream badge(s).
- On hover of each stream badge, show:
  - Source
  - Target workflow name (and optionally link)
  - Environment, scope, eventType, interval, etc.

Changes:
1) In the Workflow-Scoped section around lines ~871-891:
- Remove (or visually minimize) the header row that currently renders source badge + arrow + workflow link + “1 stream”.
- Replace it with either:
  Option 1 (strict “only stream”):
  - Don’t render that row at all; render only the stream badges.
  Option 2 (still compact but keeps context):
  - Render a tiny icon-only row (e.g., just “📡” and a “Workflow” icon), but no text; details are in hover.

2) When rendering `<StreamBadgeWithTooltip />` in workflow-scoped:
- Continue passing `source`, `workflowName`, `workflowId`, and `scope="workflow"`.

C) Make the hover popup truly “everything related to the stream”
Files:
- src/components/market/StreamBadgeWithTooltip.tsx
- src/pages/MarketSubscriptions.tsx

Enhancement to tooltip content:
1) Extend StreamBadgeWithTooltip props to accept optional “related workflows” and/or “sources”
Example props:
- relatedWorkflows?: Array<{ workflowId: string; workflowName: string }>
- sources?: string[]  (for the “All streams” section where a stream may exist under multiple sources)

2) Populate these props from MarketSubscriptions data:
- For each stream in Global section:
  - relatedWorkflows = data.workflows filtered where wf.streams includes this stream and wf.source matches the current source
- For each stream in “All Subscribed streams”:
  - sources = data.streamSourceMap[stream]
  - relatedWorkflows = data.workflows filtered where wf.streams includes stream (any source, or match primary source depending on desired accuracy)

3) Update tooltip rendering to include:
- Stream (header)
- Symbol
- Event Type (label)
- Interval (if present)
- Environment
- Scope
- Source (single) or Sources (chips/list if multiple)
- Target Workflow (if workflow-scoped)
- Related Workflows (list, show first N with “+X more”)
- Optionally: make workflow names clickable links to `/dashboard/workflow/:id`

Important UX detail:
- Keep hovercard small:
  - Use a clean “2-column label/value” layout
  - For workflow lists: show max 3-5 entries, then “+N more”
  - Keep `HoverCardContent` width around 18rem–22rem (you currently use `w-72`, which is good)

D) Make sure hover popup doesn’t render “always visible”
Files:
- src/components/ui/hover-card.tsx (optional)
If you ever see the hover content “always displayed” instead of only on hover, add a defensive visibility class:
- Add: `data-[state=closed]:hidden`
This makes the popover disappear even if animation utility classes fail or are purged.

E) Update the Workflow Receivers table (optional, for consistency)
File:
- src/pages/MarketSubscriptions.tsx

Currently, the table shows the first 3 streams as plain badges.
If you want the same “hover shows details” everywhere:
- Replace those badges with `StreamBadgeWithTooltip` as well, passing:
  - stream={sym}
  - source={wf.source}
  - workflowName={wf.workflowName}
  - scope="workflow" (or a new scope like "receiver" if you want a different label)

Verification checklist (what you should test after implementing)
1) Hover behavior
- Hover the stream badge: popup appears within ~200ms.
- Move mouse from badge into the popup: it stays open (no flicker).
- Hover over the small “X” unsubscribe button: popup behavior remains stable.

2) Console warnings
- Check browser console for:
  - “Function components cannot be given refs…”
If Badge is forwardRef’d (or trigger uses native element), these should disappear.

3) Visual expectations (matches your request)
- In workflow-scoped cards: only `btcusdt@kline_1m` is visible in the body.
- No extra “source → workflow” row unless you chose the optional compact icon-only header.
- All details are discoverable in the hover popup.

Files summary
- Must change:
  - src/components/ui/badge.tsx (forwardRef)
  - src/pages/MarketSubscriptions.tsx (remove/minimize extra visible info; pass tooltip context)
- Likely change:
  - src/components/market/StreamBadgeWithTooltip.tsx (accept more context; possibly use native trigger element)
- Optional:
  - src/components/ui/hover-card.tsx (data-[state=closed]:hidden hardening)
