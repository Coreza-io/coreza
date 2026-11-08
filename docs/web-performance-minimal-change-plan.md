# Coreza web performance: minimal-change plan

Date: 8 November 2026
Target branch: `dev`
Reviewed baseline: `63a06e6e9e783003d66d9a2a1e0a93fcd80cdb13`
Status: plan only; no implementation or runtime verification.
Constraint: minimal changes; no testing.

## Goal and boundaries

Improve initial loading and correct supplied deployment configuration without changing trading execution, financial calculations, persisted workflows, broker integrations or variable/session lifecycle.

Build on `docs/frontend-optimization-implementation.md` and `docs/live-results-auto-refresh.md`. Keep existing route splitting, scoped loaders, query deduplication, history windows, chart reconciliation and hidden runtime hosts. Do not repeat those optimizations or replace the frontend framework.

Repository configuration is evidence of the supplied setup, not proof of the currently deployed CDN, protocol or cache headers. Source file sizes are not compressed bundle measurements. No performance percentage or timing improvement is promised.

## Implementation order

### 1. Correct the supplied production delivery path

Priority: high.
Files: `Dockerfile`, `docker-compose.yml`, `nginx/nginx.conf`, `render.yaml`; short deployment clarification in `docs/SETUP.md` only if necessary.

Observed:
- The frontend Dockerfile and Compose service start Vite development mode; selecting the production profile does not change that frontend command.
- Nginx uses `coreza-backend-node:8000` and WebSocket port 8080, whereas Compose declares `coreza-backend` and WebSocket port 8081.
- Nginx preserves the /api prefix, while Express mounts /broker, /workflows and other routes directly.
- Nginx does not serve the frontend build.
- Render publishes dist, but sets VITE_API_URL while frontend clients read VITE_BACKEND_URL.

Minimal approach:
1. Keep the existing developer workflow and Windows launcher intact. Add an explicit frontend production build target and select it for the production profile; separate the existing development service/profile only as needed to prevent competing frontend services.
2. Serve the built dist directory from a static server. Keep the SPA fallback for application routes; missing JS/CSS assets must return 404 rather than index.html.
3. Point Nginx at the Compose service hostname and WebSocket port. Strip /api only on proxied API requests, including the stricter auth location, so Express receives its existing route paths. Preserve direct-backend clients; do not rename backend endpoints.
4. Configure frontend VITE_BACKEND_URL at build time, retaining localhost defaults for local development. For the same-origin deployment, use the chosen /api endpoint consistently. Supply an explicit VITE_WS_URL for the /ws proxy instead of relying on direct-port derivation.
5. In Render, replace VITE_API_URL with VITE_BACKEND_URL using a complete HTTPS backend URL. Document required deployment-specific values instead of assuming a bare host is a valid URL.
6. Apply gzip to static JS/CSS/SVG and JSON delivered through Nginx, retaining the existing gzip configuration.
7. Cache only fingerprinted build assets with a long immutable lifetime. Revalidate index.html and SPA HTML responses. Public, stable-path icons require revalidation or a short lifetime; do not give them an immutable year-long policy.
8. Retain private/no-store handling for authenticated reporting and market responses. Do not introduce shared caching of portfolios, credentials, balances or orders.

TLS/HTTP2 remains the responsibility of the actual ingress/hosting edge. Do not uncomment certificate settings, introduce a CDN provider, or assume an external edge exists as part of this patch. Document the termination point. HTTPS frontend deployments require a compatible secure WebSocket endpoint.

Intended outcome: the supplied production path serves compiled frontend assets and routes HTTP/WebSocket traffic consistently. This is not a deployment instruction or authorization to publish the application.

### 2. Remove editor catalogue loading from global startup

Priority: high.
Files: `src/main.tsx`, `src/utils/preloadIcons.ts`; an editor entry file only if editor-local warming is retained.

Observed:
- main.tsx invokes preloadIcons before React renders.
- preloadIcons imports nodeManifest.
- manifest.ts eagerly imports 73 node JSON definitions, approximately 362 KB of raw source.
- The icon files themselves total approximately 15 KB, so image compression is not the main issue.
- CachedIcon already loads icons when mounted and has bundled fallback support.

Minimal approach:
1. Remove the global preloadIcons import and call from main.tsx.
2. Rely on CachedIcon's existing on-demand path first. Remove the preloader utility only if it has no remaining consumers.
3. If retaining warming is necessary, invoke it inside the editor and deduplicate paths with a Set; do not import the manifest from global startup.
4. Keep node definition discovery, schema hydration, executor registration and editor behavior unchanged.
5. Retain App.tsx and Interface.tsx module-level lazy routes. Avoid a new per-node asynchronous schema system or a manual vendor-chunk configuration in this pass.

Intended outcome: opening login does not load the node catalogue solely to warm editor icons.

### 3. Correct the live-fill event filter without changing refresh semantics

Priority: high for correctness; small patch.
File: `src/hooks/useLiveStrategyDetail.ts`.

Observed:
- selectedId is assigned live_strategies.header.id.
- The live_fills subscription currently uses that ID for execution_id.
- The fill reader correctly filters by header.execution_id.

Minimal approach:
1. Retain the selected strategy ID for strategy/trade/portfolio filters.
2. Track the successfully loaded header.execution_id separately for the live_fills filter.
3. Scope that identity by owner/workflow/selected execution. Clear it together with existing scope resets; include it in subscription dependencies and preserve cleanup.
4. Retain 250 ms burst throttling, the 15-second fallback, visibility/offline gating, single-flight loading, pinned historical execution and stale-response rejection.
5. Do not add a Realtime publication migration. Missing publication coverage must continue to work through the existing read-only fallback.

Intended outcome: fill events, when published, reconcile the correct activation. This does not remove polling or reduce complete-history reads by itself.

### 4. Improve font discovery with a small markup change

Priority: medium.
Files: `index.html`, `src/index.css`.

Observed: three Google Fonts stylesheets are discovered through CSS @import; display=swap is already present.

Minimal approach:
1. Move the existing font stylesheet declarations into HTML link elements, preferably one combined stylesheet request.
2. Add preconnect hints for the stylesheet and font origins, with the appropriate cross-origin attribute for fonts.
3. Preserve currently used families, weights, fallback stacks and display=swap to avoid an incidental visual redesign.
4. Do not preload every font or guess remote font binary URLs.
5. Defer font removal/self-hosting and new font files until actual usage and licensing requirements are reviewed.

Intended outcome: earlier font discovery without changing typography. Zero layout shift is not guaranteed.

## Larger reporting changes: separate follow-up, not part of the minimal patch

The following are confirmed opportunities, but should not be bundled into the small changes above.

### Dashboard summaries

Files: `src/pages/Dashboard.tsx`, `src/hooks/useDashboardPerformance.ts`.

The dashboard selects full workflow rows and downloads run statuses to compute counts in the browser without explicit pagination. Live P/L reads the complete 30-day trade range every 30 seconds.

Plan:
- For metadata-only dashboard reads, select explicit fields and request three recent workflows separately.
- Reuse an existing authenticated summary/count interface only after confirming it supplies every displayed count with the same ownership and status semantics.
- If no suitable interface exists, propose a dedicated aggregate endpoint/RPC separately. Do not replace accurate totals with a limited row count or silently truncate results.
- Keep live P/L currency separation, full 30-day coverage, exclusions and realized-P/L meaning.

### Live/backtest history payloads

Files: `src/hooks/useLiveStrategyDetail.ts`, `src/hooks/useBacktestResults.ts`, `src/lib/reportingPages.ts`.

Complete trade/fill/portfolio histories are used by metrics, order aggregation, chart transformations and export. Live refresh rereads those histories. Current pagination preserves completeness.

Plan:
- First inventory the fields and full-history consumers; replace select('*') with explicit columns only when that inventory is complete.
- Treat chart windows, table pagination, exports and all-history metrics as distinct consumer needs.
- Design incremental reconciliation only with reliable handling for updates, deletions, late fills, historical corrections, deterministic cursors and activation changes.
- Keep periodic authoritative reconciliation and full-history exports where required.
- Do not change the shared reportingPages helper to impose a global cap. Do not use append-only timestamp reads as a substitute for correction handling.
- Defer new aggregation endpoints, schema/index migrations, retained financial caches and metric algorithm changes to a separately scoped plan.

Reason for separation: a small fetch cap or naive delta reader would risk incorrect portfolio/reporting results. The current optimization implementation document already identifies these as unfinished larger work.

## All 12 screenshot items mapped to this plan

| Item | Decision |
| --- | --- |
| Compress images | Keep small SVG icons; no conversion or image pipeline. |
| Lazy load | Keep lazy pages; remove global editor icon warming. |
| CDN | Keep host-specific delivery; no provider or infrastructure migration. |
| Cache headers | Add explicit production static asset/HTML policies; preserve private data policies. |
| Code splitting | Fix the bootstrap manifest dependency; defer deeper editor splitting. |
| Preload fonts | Improve stylesheet discovery/preconnect; no blanket font preload. |
| Defer scripts | Keep module entry and early theme initialization; reduce bootstrap work. |
| Reserve space | Keep chart heights and icon placeholders; defer page skeleton redesign until layout shifts are measured. |
| Fewer requests | Preserve shared query caches/pollers; fix event identity; scope larger reporting work separately. |
| Server rendering | Keep the authenticated SPA; no SSR migration. |
| HTTP/2 | Configure at the real TLS termination point separately; do not infer protocol from source. |
| Measure real users | Record a follow-up; no telemetry SDK, collector or new data collection in the minimal patch. |

## Monitoring follow-up

Backend Prometheus metrics do not measure browser loading or interaction latency. A separate small monitoring proposal can cover LCP/INP/CLS and dashboard-ready, editor-ready, node expansion, execute acknowledgement and live-event-to-display timings.

Select an existing telemetry destination before adding dependencies or endpoints. Exclude tokens, account details, workflow contents and raw order payloads from measurements. No monitoring setup or performance measurement is required by this plan.

## Constraints and completion criteria

- This commit adds documentation only.
- Subsequent implementation should use focused commits in order: production configuration, bootstrap loading, fill-event identity, font discovery.
- No tests are to be added, modified or run. No lint, type check, build, browser exercise, benchmark, load test or profiling is part of the requested work.
- Any later request to implement should retain the no-testing constraint unless the user changes it. Production build commands described above are deployment configuration, not commands executed for this plan.
- Source review and reading back the committed plan are allowed; they are not runtime validation.
- Preserve canonical graph commands, cluster runtime hosts, action registration, pins, manual/Run All/live variable scopes, execution timing and financial semantics.
- No database migration, broker request, live workflow activation, release, deployment or PR is included.
- Completion means this plan exists on dev, with implementation scope and deferrals explicit. It does not mean the performance findings have been fixed.

## Rollback

Revert each eventual implementation commit independently. Reverting bootstrap/font/filter changes requires no data conversion. Revert deployment files and redeploy the previous image if a future delivery change must be rolled back. This plan itself has no runtime effect.
