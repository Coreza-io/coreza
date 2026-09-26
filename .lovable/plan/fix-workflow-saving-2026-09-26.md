# Fix workflow saving

## Confirmed cause

The backend updates existing workflows through the `save_workflow_document(...)` database function. That function is present in the repository migration, but it is absent from the connected Supabase database. The affected workflow exists at revision `0`, and all columns required by the function are already deployed. The missing function therefore causes the update request to fail with a masked 500 error.

## Implementation

1. **Restore the atomic save function**
   - Apply the existing `save_workflow_document(...)` definition to the connected database.
   - Keep the function service-only: revoke public, anonymous, and signed-in direct execution; grant execution only to `service_role`.
   - Preserve ownership checks, expected-revision conflict detection, empty-workflow protection, version snapshot creation, and atomic revision increment.

2. **Verify database access**
   - Confirm the backend service role can execute the restored function.
   - Confirm browser roles still cannot directly insert or update workflow documents.
   - Confirm the function signature matches the backend RPC arguments exactly.

3. **Expose useful save failures safely**
   - Log the Supabase error code and safe message on the backend instead of replacing every RPC failure with only `Failed to update workflow`.
   - Map known database outcomes to clear responses: revision conflict to 409, missing workflow to 404, empty workflow to 400, and unexpected failures to 500.
   - Do not expose credentials, request authorization headers, or sensitive database details.

4. **Regression coverage**
   - Test a successful update at revision `0`, including creation of the previous-version snapshot and increment to revision `1`.
   - Test stale revision, wrong owner, empty overwrite, unchanged save, cluster metadata persistence, and nullable project assignment.
   - Verify the original workflow can save through the application after the migration.

## Completion criteria

- Saving the reported workflow succeeds and returns its new revision.
- Concurrent stale saves return a recoverable conflict instead of a generic 500.
- Workflow content, cluster metadata, and prior-version history remain intact.
- Database permissions keep writes behind the authenticated backend.
