# Unify node naming across the editor and execution

## Goal

Give each node a stable instance name and make its canvas label, live input label, dragged reference, preview and executed result identify the same canonical node.

For a newly created node whose canonical ID is `Loop3`, dragging `data.Item[0]` must produce `{{ $("Loop3").json.data.Item[0] }}` in ordinary fields, Edit Fields and If/repeater fields. Existing nodes must not be renumbered when their neighbours are deleted, reordered or collapsed.

This replaces the previous cluster-visuals plan. It includes implementation details only: no test cases or testing sections, as requested. No application code is changed by this plan.

## Confirmed findings

The full 296-line `Node-Naming-Fix-Plan.md` was reviewed against checkout `f97af3fb`, rather than assuming its earlier reviewed snapshot still applies.

- `nodeDisplay.ts` derives fallback names from a node's index among same-definition nodes. `BaseNode` uses the complete canonical list; Repeater uses an upstream subset. These can produce different names for the same ID.
- `InputPanel` displays the ID, while the canvas may display an explicit alias or calculated fallback. The numeric screenshot discrepancy requires the actual workflow to reproduce; the inconsistent computations are confirmed.
- Palette creation has its own exact-ID allocator and does not set `displayName`. Paste independently allocates IDs and space-suffixed names. Rename has a third allocator; appended suffixes can exceed its initial 50-character validation.
- Canonical transactional rename already exists. It updates identity, connections, membership, references and runtime/history state. Extend it rather than replacing it with projected-node mutations.
- Preview data can be keyed by aliases that overwrite one another; some semantic lookups use React Flow's projected nodes.
- Shared `referenceResolution` selects the first alias match. The frontend entry re-exports the backend module; `resolveReferences` also has separate frontend/backend consumers. Ambiguity handling must be added deliberately.
- Cluster reference planning already rejects multiple matches, but combines exact IDs and aliases in one search. An exact ID can therefore be rejected because another node has that alias.
- Serialization omits `displayName`; ordinary hydration resets it to ID. Import assigns an exported name to `label`, not `displayName`. The inspected import parser currently preserves incoming IDs.
- The inspected repository passes node records to the save RPC; the checked-in RPC stores JSON node arrays. Optional name metadata can fit that representation without a new table or column. Hosted deployment behaviour is not verified here.

## Corrections to the attachment

1. Keep one allocator and one read-only accessor, but distinguish instance identity from definition metadata and legacy aliases.
2. Make preservation of existing explicit names a concrete serialization change, not an optional unresolved step.
3. Use canonical IDs for newly generated selectors. A legacy display alias may differ from the ID; the shown label and reference must still resolve to the same node, not force an unsafe automatic rename.
4. Preserve the project's fresh-UUID file-import requirement. Imported IDs are a compatibility exception to the normal human-readable ID/name model; do not silently remove remount protection to simplify naming.
5. Apply exact-ID-first resolution to cluster dependencies and Edit Fields context construction as well as generic preview/backend lookup.
6. Add an explicit ambiguity outcome and its error propagation. Do not describe it as already supported or turn ambiguity into an arbitrary match.
7. Do not introduce generated-name provenance, a shared-package migration or an immutable-ID migration for all existing nodes as part of this fix.

## 1. Establish the naming contract

- Ordinary new and explicitly renamed nodes receive `id === data.displayName` in one canonical transaction.
- Existing committed IDs remain unchanged on load, history viewing and undo/redo. Preserve explicit legacy names when present; otherwise show the ID, never an array-derived label.
- `node.type`, serialized `name`, `definition.name` and `data.label` remain definition metadata. Do not repurpose them as persisted instance names.
- Reserve names against the complete canonical workflow, including hidden cluster members and nonempty legacy instance names. Exclude synthetic projection cards.
- Node names, cluster titles and edge IDs have separate namespaces.
- Dropdown values, drag source metadata, output keys and topology always use canonical IDs. Display labels never select a node.
- No renumbering, global naming counters or allocation during rendering.

## 2. Add one allocator and accessor

Create a small pure `src/domain/nodeNaming.ts` before its consumers.

### Allocation

Accept a requested base, canonical nodes, optional source exclusion and batch reservations; return the allocated name or the existing structured validation failure.

- Trim once; preserve allowed letters, numbers, spaces, hyphens and underscores and the 50-character limit for manual requests.
- Reject the reserved `__cluster__` prefix case-insensitively.
- Compare trimmed collision keys with deterministic `toLowerCase`, while preserving output spelling. Reference resolution itself remains exact/case-sensitive for compatibility.
- Reserve both canonical IDs and explicit instance names, excluding only the source during rename. Honour earlier batch reservations.
- Keep the unsuffixed first name and choose the first free positive suffix: `Loop`, `Loop1`, `Loop2`; gaps can be reused without renaming existing nodes.
- Append suffixes to the complete requested base. Do not strip meaningful custom digits: an occupied `Strategy2026` becomes `Strategy20261`; copying occupied `Loop2` may yield `Loop21`. This follows the document's literal-base policy rather than guessing generated provenance.
- Budget the base length for each suffix; check every truncated candidate for collisions. Reject invalid automatic bases through a structured result rather than silently inserting malformed nodes.
- Keep edge-ID allocation separate.

### Reading

Expose `nodeDisplayName(node)` as nonempty explicit `data.displayName`, otherwise `node.id`. Remove the list argument and index calculation from `getDisplayName`, or retain only a thin compatibility wrapper while migrating callers.

Keep `resolveNodeRename` as an adapter so existing command outcomes and error handling remain compatible.

## 3. Route creation and copying through canonical commands

### Palette and automatic companions

Update `createPaletteNodeBatch` to allocate once per node and explicitly assign ID/name together. Reserve BacktestInit before its optional OnBar companion. Preserve positions, companion eligibility, handles, edges and existing atomic cluster insertion.

Keep palette click, drag/drop and edge/cluster insertion on this batch path. Inspect the editor's reachable Loop `onAddNode` writer and the secondary `WorkflowCanvas` writer: active additions must use the shared policy and canonical insertion command; do not leave ad-hoc timestamp names on an active path or refactor unused UI unnecessarily.

### Rename

Keep the registered editor transaction, execution/listener locks, validation, runtime/pin rekey, action retirement, history identity metadata and single `restoreDocument` commit.

Use the allocator's final name in every dependent change and the success message. Remap the old ID plus a differing explicit old name only when pre-transaction identity resolution proves that alias belongs uniquely to this source. Never rewrite generic/shared aliases. A failure must leave document and runtime unchanged; publish success only after commit.

### Copy, paste, duplicate and cut/paste

Remove the independent type-count ID and display-name loops. Request each copied node's explicit instance name or ID; allocate against the destination's current canonical state and immediately reserve the result.

Build the complete old-ID → new-ID map before rewriting anything. Preserve the existing single `pasteNodesInDocument` transaction, cluster handling and cut/delete semantics.

- Rewrite pasted internal edge endpoints, membership and supported selectors using simultaneous mappings, not sequential A → B → C replacements.
- Include a copied explicit alias only when source-workflow resolution proves its identity. An alias colliding with another exact ID must not redirect that ID.
- Preserve references outside the copied selection and leave original nodes unchanged.
- Remap editable values and field-state references through the existing supported-selector utility, not arbitrary strings, output data or unrestricted text replacement.
- Any active keyboard/context-menu duplication must converge on the same command. Revalidate destination reservations at commit rather than trusting stale render closures.

## 4. Preserve names through persistence and imports

### Save, export and ordinary restoration

Whitelist an optional top-level instance `displayName` in `serializeWorkflowContent`, separate from definition `name`. Hydrate it into `data.displayName`; use ID only when it is absent. Update exported/imported types and editor mapping to preserve this field.

Carry the same representation through dirty comparison, versions, local restore, templates and execution-snapshot restoration. Undo/redo restores exact identities/names without allocation. Preserve historical snapshot labels in read-only panels rather than substituting today's names.

Older files without the field remain valid. Do not infer discarded names from array order or rewrite stored workflows automatically. Validate duplicate IDs as document errors; legacy duplicate aliases remain diagnosable, not grounds for silently changing identities.

### Manual file import

Retain fresh UUIDs for imported nodes and edges so prior component state cannot be reused. The current parser's preserved-ID behaviour needs reconciliation with this project requirement.

Before replacing the editor document:

1. Parse and validate the incoming complete document.
2. Allocate imported public instance names through the shared allocator, reserving the incoming batch rather than the outgoing replacement document.
3. Build a separate old-ID → fresh-UUID map for imported identities; keep that map distinct from allocated display names.
4. Remap edges, cluster membership and identity-bearing selectors simultaneously; remap proven unique old aliases to the correct new identity where necessary.
5. Restore the imported document and reset the workflow session/runtime ownership once; do not leave imported output/action keys attached to outgoing nodes.

Imported UUID/name divergence is an explicit compatibility case, not a second suffix policy. New dragged selectors use the imported canonical UUID and show the preserved public label. An explicit later rename uses the existing full identity transaction. If an actual import-as-add/merge path is found, reserve against the destination too; do not build a new merge feature.

No database migration is planned for optional metadata inside existing node JSON. Update backend node types/alias readers to recognise it; retain existing ownership and revision checks.

## 5. Unify labels, drag references and previews

Use the accessor in BaseNode and live InputPanel labels. Retain canonical IDs as option values and selection keys.

Create one `buildNodeReference` helper for general/If/Edit Fields/repeater insertion:

- Accept typed path segments and payload source ID.
- Resolve that exact ID against current canonical state at drop time; reject synthetic, deleted or foreign sources.
- Generate the selector with `JSON.stringify(source.id)` and existing `formatPath`. Preserve array indexes, property escaping, caret insertion and drop isolation.
- Only legacy payloads lacking a source ID may fall back to the selected source. An explicit missing ID must not silently target another node.
- Reject stale renamed sources unless an existing session-local identity map proves the replacement.

Keep upstream lists for topology/selection, not name derivation. Replace semantic projected-graph lookups in `useNodeReferences`, Repeater previews and `previewDataResolver` without changing geometry subscriptions or drag performance.

Build primary output maps by canonical ID. Resolve compatible aliases through identity metadata rather than overwriting data keys. Preserve pinned/live precedence and valid `false`, `0`, empty-string and empty-array outputs; use explicit absence checks.

## 6. Make reference resolution consistent end to end

Extend the shared identity resolver with a distinguishable resolved/missing/ambiguous result or compatible typed ambiguity error. Keep wrappers where needed; audit each caller before changing its return contract.

Resolution order:

1. Exact canonical ID wins across the complete node inventory, even if another node has that alias. Missing output for that ID must not fall through to another node.
2. Without an exact ID, collect unique explicit instance aliases, including persisted top-level names and editor `data.displayName`.
3. Preserve existing metadata aliases only when they identify exactly one node; deduplicate candidates by ID.
4. Multiple candidates produce a named-reference ambiguity error, never array-order selection. With node metadata available, validate aliases before accepting alias-keyed data.
5. Keep ordinary missing-node/property behaviour and `pickJsonSource` unchanged unless ambiguity must be distinguished.

Apply this policy to preview resolution, frontend/backend `resolveReferences`, compiler dependency lookup, ParameterResolver and Edit Fields identities/results. Update `useNodeExecution`'s Edit Fields context filtering to resolve referenced selectors to IDs before selecting results; do not discard required context or conceal alias ambiguity.

Update cluster planning's combined ID/alias search to the same precedence, preserving self-reference, scope and ordering rules. Do not change Loop scheduling, run modes or execution outputs.

Propagate ambiguity through existing expression diagnostics and failed action outcomes. Preview render paths must catch it and display a diagnostic rather than crash. Backend execution must fail the affected expression rather than execute against arbitrary data. Audit preview/static compilation and runtime catches so one layer cannot silently swallow the new diagnostic.

Existing malformed `$("Loop")` selectors cannot reliably reveal whether the author intended Loop or Loop2. Repair only when recorded identity or a unique alias proves the target; otherwise retain the expression and report the issue for user correction.

## Technical change map and delivery order

1. Shared allocator/accessor and reference-identity contract.
2. Rename adapter, palette batch, active direct-add writers and canonical paste/remapping integration.
3. Serializer, hydration, export/import and restoration paths; preserve fresh-UUID import handling.
4. BaseNode/InputPanel labels and shared reference builder; both drop paths and canonical previews.
5. Backend/shared reference resolver, frontend/backend resolution consumers, compiler/ParameterResolver, Edit Fields context and cluster reference planning.
6. Record the shared naming and identity-resolution architecture rules in `AGENTS.md`, without replacing canonical mutation or render-only projection rules.
7. Copy backend changes to `coreza-io/coreza-backend` and deploy them with the frontend compatibility changes. A frontend-only release does not update the separately deployed execution service.

Keep scope limited to naming, identity-based reference lookup and persistence compatibility. No cluster projection rewrite, edge rendering change, new store, global counter, queue/API redesign, batch execution change, output-shape change or all-node immutable-ID migration.
