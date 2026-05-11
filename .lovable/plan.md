
# Harden `setup/setup.js` Supabase CLI flow + finish key migration

Folds the new `SUPABASE_ACCESS_TOKEN` requirement into the same pass that finishes the legacy-key cleanup. All work is in `setup/setup.js`, `setup/validate.js`, the three `.env.example` files, and `supabase/config.template.toml`. No frontend or backend runtime code changes (those already use `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`).

## 1. Re-do credential collection in `setup.js`

Replace `collectSupabaseCredentials` + `validateCredentials` with five strict prompts and validators:

| Prompt | Stored as | Validator |
|---|---|---|
| `Supabase Project URL:` | `supabaseUrl` | regex `^https://([a-z0-9]+)\.supabase\.co/?$` → also sets `projectId` |
| `Supabase Publishable Key (sb_publishable_...):` | `supabasePublishableKey` | starts with `sb_publishable_` |
| `Supabase Secret Key (sb_secret_...) [backend only]:` | `supabaseSecretKey` | starts with `sb_secret_`; print backend-only warning |
| `Supabase Access Token (sbp_...) [CLI setup only]:` | `supabaseAccessToken` | starts with `sbp_` |
| `Supabase DB Password (postgres role) [used for db push]:` | `supabaseDbPassword` | non-empty; never echoed/logged |

Rules:
- Each validator throws the exact error string from spec section 3.
- Helper text printed once before prompts (spec section 9).
- `loadExistingCredentials` reads new var names only; legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are ignored (legacy values would fail the new prefix check anyway).
- DB password input read with `terminal: false` style (no echo) where possible; otherwise just don't reprint it.
- Add `mask(value)` helper → returns `"sb_secret_****" + last4`. Use everywhere a secret would otherwise be logged.

## 2. Rewrite env-file generation

`setupEnvironmentFiles` writes:

**Frontend `.env`** (no secrets):
```
VITE_BACKEND_URL=http://localhost:8000
VITE_SUPABASE_URL=<url>
VITE_SUPABASE_PROJECT_ID=<id>
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
WEBSOCKET_PORT=8081
VITE_BACKEND_WS_URL=ws://localhost:8081
VITE_INACTIVITY_TIMEOUT=600000
```

**Backend `coreza-backend/.env`** (no access token, no DB password):
```
SUPABASE_URL=<url>
SUPABASE_PROJECT_ID=<id>
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SECRET_KEY=<sb_secret_...>
COREZA_ENCRYPTION_KEY=<generated>
REDIS_QUEUE_URL=redis://localhost:6379
PORT=8000
WEBSOCKET_PORT=8081
MARKET_STREAM_PORT=8090
WORKFLOW_JOB_ATTEMPTS=0
BACKTEST_EXECUTION_MODE=auto
ALPACA_REDIRECT_URI=http://localhost:8000/api/oauth/alpaca/callback
BINANCE_REDIRECT_URI=http://localhost:8000/api/oauth/binance/callback
SCHWAB_REDIRECT_URI=http://localhost:8000/api/oauth/schwab/callback
```

**Stream service `.env`** (secret only, no publishable/anon, no access token):
```
SUPABASE_URL=<url>
SUPABASE_SECRET_KEY=<sb_secret_...>
COREZA_ENCRYPTION_KEY=<generated>
REDIS_QUEUE_URL=redis://localhost:6379
MARKET_STREAM_PORT=8090
```

**Setup-only `.env.setup.local`** (gitignored, written for re-runs / CI inspection):
```
SUPABASE_PROJECT_ID=<id>
SUPABASE_ACCESS_TOKEN=<sbp_...>
SUPABASE_DB_PASSWORD=<password>
```
Add `.env.setup.local` to root `.gitignore` if absent.

## 3. CLI flow with hard-fail error handling

Add `runOrThrow(label, command, friendlyError)` that wraps `spawnSync` (`stdio: 'inherit'`, `env: supabaseEnv()` with `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` injected). On non-zero status: print `friendlyError`, throw — `run()` catches and exits 1. No more silent `try/catch` "manual setup required" branches that print fake success.

Replace existing flow (`setupSupabaseProject`, `deployEdgeFunctions`, `runDatabaseMigrations`) with one ordered method `runSupabaseCli()`:

1. `npx supabase --version` (preflight; install dev-dep on miss as today)
2. `npx supabase login --token "$SUPABASE_ACCESS_TOKEN"` → spec 7.1 error
3. Generate `supabase/config.toml` from template
4. `npx supabase link --project-ref <id>` → spec 7.2 error
5. Create migration file from `setup/database-schema.sql` (existing logic kept)
6. `npx supabase db push` (env carries `SUPABASE_DB_PASSWORD`, no `--db-url`, no prompt) → spec 7.3 error; keep `handleMigrationPushError` repair-then-retry — but the retry must also throw on failure
7. `npx supabase functions deploy` → spec 7.4 error
8. `npx supabase secrets set COREZA_ENCRYPTION_KEY="<key>"` → reuses spec 7.4 message style

Track booleans (`linked`, `migrated`, `functionsDeployed`, `secretsSet`) and only print the matching ✅ line in `showCompletionMessage` if true. If the flow threw, summary is never reached.

## 4. Logging hygiene (spec 8)

- Replace any `console.log(... key ...)` with `mask()`.
- Never log `supabaseDbPassword` or `encryptionKey` at all.
- Remove the `npx supabase secrets set COREZA_ENCRYPTION_KEY="..."` echo lines from the manual-fallback block (delete the block entirely — flow is now hard-fail).

## 5. `setup/validate.js` adjustments

- Add backend `.env` check for `SUPABASE_PROJECT_ID` and `SUPABASE_PUBLISHABLE_KEY` (already there).
- Add frontend `.env` check for `VITE_SUPABASE_PROJECT_ID`.
- Add new check: `.env.setup.local` exists and contains `SUPABASE_ACCESS_TOKEN=` and `SUPABASE_DB_PASSWORD=` → warning (not error) since the file is local-only and may legitimately be absent in deployed environments.
- Existing schema-table check is already up to date — leave alone.

## 6. `.env.example` files

- Root `.env.example`: keep current frontend-only template (already correct).
- `coreza-backend/.env.example`: drop `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` lines (these don't belong in backend runtime). Add `SUPABASE_PROJECT_ID=`.
- `coreza-backend/market-stream-service/.env.example`: replace `SUPABASE_ANON_KEY=` / `SUPABASE_SERVICE_ROLE_KEY=` with `SUPABASE_SECRET_KEY=`. Rename `REDIS_URL=` → `REDIS_QUEUE_URL=`.
- New `setup/.env.setup.local.example` documenting the three CLI-only vars.

## 7. `supabase/config.template.toml` — apply guide section 9

- Drop any `[edge_functions]` block.
- Move `enable_confirmations = false` under `[auth.email]`.
- Keep per-function `verify_jwt = false` blocks unchanged.

## 8. Out of scope

- Backend runtime code (`coreza-backend/src/config/supabase.ts`) already reads `SUPABASE_SECRET_KEY` with a deprecation fallback — leave as-is.
- Frontend `src/integrations/supabase/client.ts` — already env-driven.
- Postgres role string `'service_role'` in RLS policies — that's a database role, not a key.
- Lovable runtime secrets named `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — those belong to the connected Supabase project (not the self-host setup). Renaming them in the platform secrets store is a separate ops step you'd do per-project from the dashboard.
- README/SETUP.md doc updates — flag if you want them in a follow-up; this plan only touches setup scripts and templates.

## Acceptance check (mapped to spec section 10)

All ten checkboxes covered:
- prompts + sbp_ validation → §1
- DB password read + non-interactive `db push` (env-injected) → §1, §3 step 6
- `supabase login --token` step → §3 step 2
- `link` step → §3 step 4
- `functions deploy` → §3 step 7
- `secrets set COREZA_ENCRYPTION_KEY` → §3 step 8
- masked logging only → §1, §4
- no false success — booleans gated in `showCompletionMessage` → §3
