## Root cause (recap)

`supabase/migrations/` holds 24 historical Lovable-generated incremental migrations. The earliest one (`20251110090945_*.sql`) does `ALTER TABLE public.users ADD COLUMN timezone` but no migration in the folder ever creates `public.users` — that CREATE lives only in `setup/database-schema.sql`. So `supabase db push` against a fresh DB fails on the first ALTER.

The historical files are Lovable's internal change log; they are not needed by self-hosters because `setup/database-schema.sql` already represents the final, complete schema (15 `CREATE TABLE IF NOT EXISTS` statements covering every table the app reads/writes).

## Fix: setup wipes old migrations and writes one fresh migration

On every self-host install, `setup.js` will:

1. **Delete every existing `*.sql` file** under `supabase/migrations/` (keep the directory and any non-SQL files like `.gitkeep`).
2. **Write one fresh migration** at `supabase/migrations/00000000000000_coreza_initial_schema.sql` whose contents are exactly `setup/database-schema.sql`.
3. **Run `supabase db push`** — applies the single consolidated schema, succeeds.

No probing of remote state, no archive folder, no diffing — simple and deterministic. Self-host setup is the single source of truth; `setup/database-schema.sql` is the schema.

### Idempotency on re-runs

Re-running `node setup/setup.js` against a Supabase project that already has the schema applied:
- Step 1 deletes the previous `00000000000000_coreza_initial_schema.sql`.
- Step 2 rewrites it (same content, unless schema file changed).
- Step 3 `db push` sees the migration version `00000000000000` is already applied remotely → no-op.

If the user edited `setup/database-schema.sql` between runs, the new content is just a rewrite of the same migration version, which `supabase db push` will treat as already-applied (it tracks by version number, not content hash). For schema evolution after the initial install, users add new migration files manually — outside the setup script's responsibility.

### Safety guard

Before deleting, if `supabase/migrations/` contains any file NOT matching either:
- `00000000000000_coreza_initial_schema.sql` (our managed file), or
- the known historical Lovable filenames (timestamp-prefixed `.sql` from before today),

print a warning listing the unexpected files and abort unless the user passes `--force-reset-migrations`. This protects users who later add their own custom migrations from accidental deletion.

For the current first run, the 24 known Lovable files match the historical pattern → safe to delete without prompt.

### Touched files

- `setup/setup.js` — replace `prepareMigrationFile()` body with the wipe-and-write logic above; add the safety-guard check.
- `setup/validate.js` — keep as-is (already counts `*.sql` files; will see 1 after setup).
- No frontend, backend, or DB-schema changes.
- The 24 existing files in `supabase/migrations/` will be removed by setup at install time. (If you also want them gone from the repo right now so the diff is visible before users run setup, say so and I'll include that deletion in the implementation step.)

### Acceptance

- Fresh install on empty Supabase project → exactly one migration applied, all 15 tables created, `db push` succeeds.
- Re-running setup → same single migration file, `db push` is a no-op.
- User-added custom migrations are preserved (safety guard blocks accidental wipe).
