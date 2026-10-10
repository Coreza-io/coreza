# Implement lastN and reliable reference drag insertion

## Goal and selected scope

Implement the complete 232-line attachment's narrow release: **`lastN(array, count)` in typed Edit Fields v2 only**, plus shared pointer-position reference insertion across existing native text fields. Preserve generic legacy expressions, literal slices, canonical identities, nested clusters and normal editor execution.

Select Expression + Array and use:

```text
{{ lastN($("get_atr_history").json.data.value, $("short_len").json.data) }}
```

The paths above depend on actual output envelopes; they are not an instruction to unwrap every `data` property. The attachment's acceptance requirements are retained because this request asks for complete coverage. No application changes or deployments are authorized by plan authoring.

## Confirmed review and corrections

Checked current checkout `eff5d3d3`, rather than assuming the attachment's `7835314` matches it:
- `safeExpression.ts` supports arrays, literal slices, named references and own-property reads; function calls are rejected. There is no implemented lastN intrinsic or helper capability.
- `editTemplate.ts` is quote-aware and rejects nested/unclosed templates. Pure code returns native values; mixed templates stringify. Its rendered ceiling checks characters after rendering, not bounded UTF-8 bytes.
- `editFields.ts` uses the shared evaluator and shallow destination checks. Each typed row reads original input. The manual route and executor retain different legacy seeds/wrappers.
- Typed drop uses the existing selection, not pointer coordinates. `editFieldReferenceDrop.ts` falls back to wrapped insertion when whole-template compilation fails. Basic, condition, Switch/case and overlay handlers append.
- `NodeFieldRenderer` selects all on focus. Fixed-to-expression editing can replace an input with a textarea. Editable controls bypass canvas undo; explicit field transaction history is not present.
- `handleChange` and batch changes write immediately through the canonical updater; a separate 50ms effect also synchronizes drafts. This is **not merely a deferred canonical commit**. The canonical updater currently applies patches without the full live mutation guard.
- Typed rows are transported raw. `templateCompiler` currently gives them empty dependencies and unions dependency sets only from accessor entries, not static entries. Repair both gaps; do not claim missing metadata proves every run lacks data.
- Manual payload builds fallback data for every node and synthesizes unresolved identities with `resolved?.id ?? name`. The route drops explicit display-name metadata. Preview has different fallback behavior.
- Pins already enter the execution store through `setPinned`. Preserve pins available there; do not interpret the attachment's no-new-fallback policy as disabling existing pins.
- Cluster planning already resolves effective leaves and uses normal actions, but reference collection is regex-based. Run All dependency readiness is graph-edge-driven.
- Drag paths use typed segments and current canonical IDs. The safe tokenizer lacks some JSON string escapes emitted by `JSON.stringify`, including Unicode control escapes. Correct safe decoding rather than blaming the drag-payload JSON parser.
- The authenticated capabilities response currently advertises hierarchy readiness only. Helper support must be added independently without coupling it to the cluster database guard.

External n8n comparisons and reported probes are reference material, not verified behavior of this checkout. Deployed helper support, browser geometry and actual user result envelopes remain unverified.

## 1. Freeze the helper and compatibility contract

- Accept exactly two expression operands. Source must be an array; count must be a number that is finite, nonnegative and a safe integer. No string/boolean/null coercion; negative, fractional, missing and unsafe counts fail.
- Evaluate operands once in source order and validate both contracts before zero/empty early returns. Numeric `-0` equals zero. Return a fresh empty array for zero; otherwise a new shallow suffix copy, capped at source length. Never mutate input or blindly use `slice(-count)`.
- Preserve nested helper composition and ordinary post-result indexing/member access without inventing Python projection semantics for a function result.
- Preserve bare input identifier `lastN` when it is not called. Permit only the trusted registered intrinsic: no host lookup, computed function names, methods, callbacks, eval or dynamic node names.
- Helper registration is explicitly enabled by the typed Edit Fields caller. Keep compilation/cache options distinct if other consumers are added; generic fields never acquire safe-function semantics by exception fallback.
- Preserve pure native types, safe mixed-template rendering, typed destination rules, whitespace, literal slice zero behavior, original-input row semantics and legacy persistence restrictions.
- Missing node, ambiguous alias, unavailable output, invalid source/count and resource/serialization failures have separate codes and positions. Strict missing-reference behavior applies only inside the new helper's evaluated subtree; unrelated existing reads still return undefined as before. Short-circuiting must not eagerly fail unreachable branches.

## 2. Shared safe implementation and bounded output

Extend backend-owned `safeExpression.ts`, `editTemplate.ts` and `editFields.ts`, keeping their frontend imports as the single implementation:

1. Add an intrinsic AST node with both argument ASTs/positions; extend parser, evaluation and reference/feature visitors. Preserve existing compile limits and error offset mapping.
2. Add immutable compiled feature metadata identifying lastN-bearing rows. Allocate runtime budgets per evaluation, never inside cached compiled objects.
3. Use a cumulative budget across the entire helper-bearing row: nested calls, code segments, array/projection/slice allocations, rendering and selected-output boundary traversal. Meter upstream argument operations before allocation; guarding only lastN's final copy leaves large slice/projection arguments unprotected.
4. Proposed starting ceilings: **100,000 copied elements, 1,000,000 work steps, 256KiB UTF-8 output** per helper-bearing row. Treat these as provisional, centrally configured limits requiring representative trading-output calibration, not measured capacity. Add bounded traversal depth/cycle handling.
5. Compute suffix length before copying; a small suffix must not require scanning the whole source. Selected sparse slots/undefined values fail the strict output boundary rather than silently becoming null.
6. Validate newly assigned helper-bearing row values before assignment/publication: reject undefined root/property/slot, functions, symbols, BigInt, cycles, non-finite numbers and unsupported host objects; preserve JSON null. Do not invoke custom toJSON/getters to sanitize values. HTTP JSON is the normal context boundary, not a guarantee against hostile in-process objects.
7. Count UTF-8 bytes and JSON escaping incrementally in bounded encoding/traversal before an unbounded stringify allocation. Apply the same accounting during mixed rendering and preview. Do not truncate or stringify first and check afterward.
8. Keep existing non-helper rows and inherited/legacy seed serialization behavior unchanged. Optional-field omission is allowed only by an explicit schema; do not add a new omission policy to this release.
9. Reuse structured field/node/row/position errors, extending phases for serialization/resource failures. Do not publish partially accumulated success when a later row fails.

Native undefined remains an internal value; strict helper output rejection is a boundary rule, not conversion to null. Preview can show a bounded native summary and a separate boundary diagnostic when safe to obtain both.

## 3. Identity, available results and transport

Introduce a shared typed-context builder/resolution contract for preview, manual actions and server evaluation:
- Capture canonical identity inventory and selected result availability once per evaluation/payload. Use exact IDs before unique aliases, including explicit displayName; ambiguity never resolves by array order or result availability.
- For new-helper named references, accept only output available in the current execution store/context, including already integrated pins. Do not treat node configuration/static `data` as an executed result or add a new pin/static fallback. Existing non-helper expressions retain their current fallback behavior.
- Distinguish an identity that does not exist from a known node with no result. Send truthful identity/alias metadata sufficient to detect ambiguity, never invented nodes. Resolve results by canonical ID without alias-key fallback borrowing another node's result.
- Capture representative actual history/count envelopes during implementation before finalizing adapters. Preserve StandardNodeOutput/NodeResult wrappers and existing `pickJsonSource` semantics; no repeated `data` unwrapping or n8n item/run pairing.
- Preserve selected original input and latest available Loop result semantics. Immutable evaluation snapshots are per invocation: do not freeze results once for an entire cluster, which would hide outputs produced by earlier actions.
- Before HTTP JSON serialization, check selected helper argument data with bounded checks so undefined/sparse values cannot disappear or become null before server validation. Send only relevant results plus truthful identities, with bounded request size. Do not reject unrelated legacy result/configuration fields globally.
- Update comparator input validation to retain relevant displayName metadata and enforce payload bounds. Client-supplied expression context is calculation input, never authorization; user identity remains token-derived. Server Run All uses authoritative saved nodes/results.
- Preserve stale-session/cancellation publication guards and existing single-notification error pathway. Detailed errors belong in Output Data, with concise field feedback.

## 4. Dependencies and execution parity

- Extend typed AST visitors through both helper operands, nested calls, arrays and members. Deduplicate genuine references; ignore fixed rows and selector-looking quoted strings.
- In `templateCompiler`, retain raw typed rows while collecting expression dependencies. Union dependencies from static and accessor entries and preserve them in optimized metadata/slot paths, including mixed generic/typed parameters. Never pre-evaluate typed rows during parameter compilation.
- In `useClusterExecution`, route typed expression rows through shared AST discovery, skip typed fixed rows, and retain the existing separate legacy collector for other values.
- Use resolved internal references as ordering prerequisites only for eligible effective leaves. External references consume available output or diagnose; never execute outside the captured scope.
- Preserve one parent controller/lock, normal actions, BacktestInit's single manual initialization, Loop repetitions/feedback and unique leaf progress. Do not queue Cluster Execute or recursively start children.
- Run All remains graph-edge-driven; reference lookup must not create scheduling edges or implicitly run missing upstream nodes. Same helper semantics do not imply identical input seed, envelope or scheduling behavior across modes.

## 5. Tolerant lexical insertion and encoded paths

Replace compilation-as-location-detection with a pure tolerant span scanner shared with template delimiter rules; strict compilation remains authoritative for evaluation.
- Classify text, unquoted code, quoted code strings, delimiter tokens and ambiguous malformed spans; expose UTF-16 ranges and diagnostics without requiring a valid full expression.
- Safe typed text gets one wrapped selector; unquoted code gets raw selector. Block insertion into quoted strings, within delimiter tokens, or across partial quote/template boundaries.
- A full unclosed `{{` permits raw insertion into unambiguous unquoted code; strict incomplete-expression errors remain. Block lone/ambiguous brace fragments, with repair feedback rather than wrapped fallback.
- At expressionStart/before the closing pair use code context; immediately before opening/after closing use text context. Exactly selected whole-template replacement inserts one wrapped selector.
- Generic legacy destinations support pointer placement of complete selector templates and whole-template replacement only; reject composed raw-code insertion without switching their language.
- Keep current payload/identity design; reject deleted/stale/projection sources at commit while allowing hidden canonical leaves. Decode JSON escapes correctly in safe string literals, preserving numeric index versus string key and arbitrary encoded keys.
- Unsupported legacy selector escapes receive a clear refusal, not corruption or a global legacy resolver rewrite.
- Offer only a user-triggered repair preview for the recognized nested-slice example once lastN support is available; require a reliable recognized pattern. No recursive brace removal, automatic conversion, trimming or quote/fixed-value rewrites.

## 6. Pointer geometry and shared native-control adapter

Add proposed `textControlCaret.ts` and `useReferenceTextDrop.ts`; extend the existing `ReferenceDropTarget` plumbing rather than creating separate editors:
- Map client coordinates to UTF-16 offsets/caret rectangles with an offscreen styled mirror and range/glyph measurements. Handle borders, padding, font, wrapping, tabs, trailing newlines, scroll, CSS transforms and React Flow zoom; snap to grapheme boundaries.
- Limit initial support to standard LTR desktop Chromium. Do not claim RTL/mobile/other-browser support before it is established.
- Animate/throttle dragover measurement, recompute on value/scroll/resize and final drop, and support bounded edge autoscroll. Caret overlay is noninteractive/aria-hidden and token-styled; hovering does not alter the saved selection.
- Track destination-owned active selection before drag blur, with field/control identity, value revision and range. Replace only when the pointer is inside its half-open range; elsewhere insert at pointer, including at selection end. Invalidate stale ranges. Keyboard insertion replaces its saved valid selection independently.
- Use an explicit live text-control ref for wrapper drops. Geometry failure/no eligible target rejects without mutation; never append or reuse stale selection as a pointer fallback.
- Non-text number/select/checkbox targets require explicit Expression selection/dedicated text control; never call selection APIs on unsupported inputs or silently swap a boolean selector after a wrapper drop.
- Clear caret/classes on genuine leave, cancellation, Escape, disabled state and unmount. Ignore foreign/palette payloads; route one drop once, isolating canvas/parent handlers.

## 7. Atomic field edits, focus and history

- One shared transaction stores field/row identity, before/after value and mode, source-map update and transient selection/scroll. Read latest drafts and live canonical source/session/guard immediately before commit; stale callbacks cannot overwrite newer typing or resurrect deleted rows.
- Reuse owner callbacks for Basic, condition, Switch/case, overlays and typed rows. Source-map adapters preserve existing record/array shapes without a persisted schema migration.
- Add a guarded canonical field-update boundary covering loading, execution, read-only and session changes. Prevent the existing delayed sync effect from overwriting an acknowledged transaction.
- Restore focus with preventScroll after React commit, retain control scroll, collapse caret after inserted text and suppress select-all once. Fixed-to-expression changes must resolve the newly mounted textarea, not a detached input.
- Provide explicit field-local history for typing, paste, composition and drops. Each drop is one undo unit; neighboring typing remains undoable. Handle Ctrl/Cmd-Z, redo variants and beforeinput history requests without triggering canvas structural undo or double-applying browser history.
- Track row identity transiently across reorder/removal; clear or rebase history after external document restore/session changes. Do not persist caret, mirror, history or source-map bookkeeping as undeclared node fields.
- Reject/atomically roll back a drop whose mode/control transition cannot safely restore history/focus; no history-unsafe fallback or no-op history entry.

## 8. Capability, persistence and rollout

1. Implement shared intrinsic/budgets/boundary and context/discovery contracts first; manual comparator and ControlFlowExecutor consume the same code.
2. Extend authenticated capabilities with proposed `safe_expression_helpers.lastN: { contract_version: 1, scope: "typed-edit-fields-v2" }`, binding strict arguments, budgets and helper output boundary. Report helper support independently of hierarchy readiness.
3. Add session-aware frontend capability consumption, unavailable/unsupported feedback and stale-response guards. Missing/unknown support blocks helper-dependent authoring/evaluation, not all ordinary typing or legacy workflows. Server enforces its supported contract independently.
4. Wire shared lexical insertion, geometry, owner adapters and field history together. Preserve existing theme/components and avoid graph-wide drag subscriptions.
5. Keep expression text in existing typed row values through save/export/import, dirty comparison, versions, undo and run snapshots. Manual import retains fresh UUID identities and simultaneous reference remapping, including references inside helper arguments.
6. **No database migration, generic expression_version marker, new table, queue or execution engine is required.** The hierarchy migration/guard remains untouched.
7. Manually copy backend changes to `coreza-io/coreza-backend`; deploy evaluator/readers/capability before enabling dependent frontend authoring. Establish actual envelopes, calibrated limits and deployed capability before release, not from source presence alone.
8. Rollback disables new helper authoring while retaining saved-text readers and compatible evaluation, or explicitly refuses unsupported runs. Never reinterpret helper text through legacy fallback.
9. During implementation record scoped architecture decisions in AGENTS.md and requested work/blockers in roadmap.md; plan mode changes neither file.

## 9. Acceptance criteria and release evidence

These are future verification requirements, not reported passes. Extend existing safeExpression, editTemplate, editFieldsV2, editFieldsRoute, editFieldsParameterResolution, editFieldReferenceDrop, referencePath and legacy resolveReferences-parity suites. Add real Chromium coverage using actual canonical owner callbacks; jsdom cannot establish pointer geometry or field history.

### Language, native values and safety
- Preserve rejection of the submitted nested slice, dynamic bounds, .slice and step syntax. Verify positional diagnostics without partial success; avoid hardcoding an offset across different source strings.
- Verify lastN counts 0/-0/1/2/equal/oversized, empty sources, fresh shallow copies and unchanged inputs. Reject every negative/fractional/string/boolean/null/undefined/non-finite/unsafe count, and non-array source, including invalid combinations with zero count or empty arrays.
- Distinguish missing identity, unavailable result, ambiguous alias and missing source/count paths. Confirm strict behavior stays inside evaluated helper subtrees and does not change unrelated missing-value reads or short-circuiting.
- Reject wrong arity, unknown/computed functions, callbacks, dynamic selectors, forbidden prototype keys and host access. Verify bare input identifier lastN and post-helper member/index semantics.
- Preserve existing literal [-5:]/[-0:], pure false/0/empty string/native types, Array destination versus interpolated string, comparisons versus adjacent template text, whitespace, safe null/undefined interpolation and legacy differences.
- Verify quoted braces/escaped keys cause neither false delimiters nor dependencies. Check new-helper undefined properties/slots, sparse arrays, non-JSON values and cycles fail with paths while legacy omission/null serialization remains unchanged.
- Check exact approved resource thresholds and overflow, nested/repeated cumulative work, upstream slice/projection allocation, traversal depth, multibyte UTF-8 and JSON escape expansion. No truncation, per-call reset or unbounded pre-check encoding.

### Execution, dependencies and persistence
- Compare preview, authenticated manual route, Run All, optimized/fallback params and Cluster Execute against matching canonical/result snapshots; separately record seed/wrapper differences.
- Verify both operand dependencies, deduplication, quoted/fixed-row exclusion, static-row metadata and mixed typed/generic slots; exact IDs win and ambiguous aliases fail.
- Cover execution-store pins, absent outputs and static-only data without invented fallback or recursive envelope unwrapping. Capture actual history/count/manual/Run All/Loop/pin envelopes before adapter sign-off.
- Verify Run All does not schedule references without edges; parent/child cluster scopes order only eligible internal actions, preserve Loop feedback/latest results and never execute external references or recurse into child runs.
- Preserve original input across two typed rows. Verify errors, cancellation and changed sessions cannot publish stale/partial success or duplicate notifications.
- Round-trip raw helper text through save/reload/export/import/version/history/run snapshots and fresh-ID reference remapping. Phase A adds no generic marker; unknown helper capability/rollback refuses unsupported semantics without legacy fallback. Generic legacy date/null/string/escape behavior remains unchanged.

### Drag, focus and history
- Cover empty/start/middle/end, selection inside/outside/at end, inactive/stale ranges and keyboard insertion. Verify latest-value repeated drops and caret collapsed after exactly one transaction.
- Cover raw safe-code versus wrapped text, exact whole-template selection, partial delimiter/quote crossings, code strings, escaped braces, full unclosed opening, malformed slice and lone/half delimiters. Ambiguous cases reject without mutation; generic fields never silently switch language.
- Cover hard/soft wrapping, proportional fonts, tabs, trailing newline, horizontal/vertical scroll, resize, browser zoom, React Flow zoom and autoscroll. Emoji/combining sequences must not split; do not claim unsupported RTL/browser targets.
- Verify focus/select-all suppression, mounted input-to-textarea restoration, scroll retention, typing/paste/composition then drop then undo/redo, source-map/mode restoration and no canvas structural undo.
- Exercise Basic, condition, Switch/case, overlay, typed rows and wrapper targets. Geometry failure, invalid target or unsafe swap rejects/rolls back atomically without append or history residue.
- Round-trip numeric 0 versus string "0", dotted/empty/spaced/quoted/backslash/newline/brace/Unicode keys; unsupported legacy escapes give useful refusal. Deleted/renamed sources reject stale IDs, hidden leaves remain valid and projection IDs reject.
- Cover foreign/palette/invalid payloads, genuine leave, Escape, disabled/unmount and guards changing after callback capture. Cleanup occurs even when mutation is blocked; no duplicate drop.

Release gates: actual envelope evidence, fixed/deployed capability contract, calibrated budgets with bounded encoding evidence, and Chromium pointer/history acceptance. Synchronous evaluation cannot be interrupted merely by an abort signal; bounded work is mandatory and cancellation is checked before/after evaluation. Host proxies/getters are not a claimed sandbox. External n8n runtime parity remains unverified and is not a release requirement.

## Deferred alternatives and explicit exclusions

Computed Python bounds and array-only slice are independent alternatives, not mandatory phases; their raw zero/negative semantics do not implement a strict last-count contract. Preserve existing literal slice syntax.

Generic safe-language adoption is separate authorization: it would need an explicit persisted version/router, complete serialization/import/history/snapshot support, capability/writer protection, unknown-version refusal and user-triggered atomic conversion. Absent markers stay legacy; no failure fallback. Do not implement that architecture for lastN.

No full JavaScript/n8n engine, recursive templates, dynamic selectors, callbacks, arbitrary methods, item pairing, .first/.all proxies, leading-equals format, automatic upstream execution, envelope rewriting or CodeMirror replacement. n8n receives no changes. Canonical hierarchy/projection/runtime rules remain authoritative throughout.
