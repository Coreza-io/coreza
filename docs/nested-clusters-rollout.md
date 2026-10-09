# Nested cluster rollout

The editor reads two cluster levels, but nested creation and paste require the authenticated `/workflows/capabilities` response to advertise `cluster_format_version: 2` and `max_cluster_depth: 2`. Capability is separate from editable workflow content.

While capability is unavailable, flat updates retain the legacy save RPC argument shape, including requests from clients that declare format two. Verify a flat save before applying the hierarchy migration as part of staged deployment. Replacements of existing nested documents still require the format-two declaration and deployed protection, even when the requested replacement dissolves all clusters.

Malformed file imports are rejected before replacing canonical or runtime state. Loading/version recovery keeps raw invalid entries and quarantines their identifiable parent and ownership components until explicit repair; it cannot select an owner by ignoring a parse-invalid record. Metadata edits use local drafts and one validated, undoable commit, and structural commands refuse live execution/drag or stale-session mutations.

1. Synchronize the changed `coreza-backend` sources with the standalone backend. Deploy readers, validators and write guards before enabling frontend authoring.
2. Apply `supabase/migrations/20261009090000_cluster_hierarchy_writer_guard.sql`. It upgrades the atomic save RPC with an optional writer declaration and adds a trigger that refuses alternate graph replacements of nested documents. Canonical nodes, edges and cluster JSON remain in existing columns; versions retain the complete JSON.
3. Verify the hosted `cluster_hierarchy_write_ready` RPC returns true for the backend identity. Check that the authenticated capability endpoint advertises format two/depth two.
4. Exercise a supported nested create/save/read/version restore, including an outer with no direct nodes. Confirm parent links survive and a parent-only edit advances the saved document revision.
5. Attempt an old writer's replacement of a nested document with flat and empty cluster arrays: both must refuse without changing graph/revision. Confirm a supported writer can intentionally submit an empty cluster array to dissolve everything. Verify omitted metadata on compatible partial updates is retained, and stale revisions/other users remain refused.
6. Verify editor Execute runs the parent leaf scope once with ordinary actions, while navigation changes only display. Hosted run snapshots and retained scoped compiler requests must contain canonical effective leaves.

No hosted migration or RPC verification was possible in the implementation session: Supabase credentials were absent. The capability therefore fails closed until the deployed schema is verified. The standalone `Coreza-io/coreza-backend` repository returned GitHub 403/404 and could not be synchronized in this session. The main PR contains all backend changes.

To export the backend-only sync patch from a checkout of the PR branch:

```sh
git diff --binary 8714f5a4 HEAD -- coreza-backend |
  sed -e 's|a/coreza-backend/|a/|g' -e 's|b/coreza-backend/|b/|g' > backend-sync.patch
```

On a clean branch in the standalone backend, inspect its differences and run `git apply --check backend-sync.patch` before `git apply backend-sync.patch`. The patch was checked against the embedded backend at baseline `8714f5a4`; the inaccessible standalone checkout may differ. Run the workflow hierarchy, compiler and repository save tests before creating its companion PR.

Rollback disables nested authoring while retaining readers, the save RPC declaration check and the alternate-writer trigger. Never reintroduce a metadata-stripping writer against existing nested documents.
