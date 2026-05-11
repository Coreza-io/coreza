# Fix backend startup: missing `REDIS_CACHE_URL` and `SUPABASE_ANON_KEY`

## Problem

Two separate env-var gaps cause `npm run dev` in `coreza-backend` to crash on a fresh self-host install:

1. **Current crash:** `coreza-backend/src/config/redis.ts` requires either `REDIS_CACHE_URL` or `REDIS_URL` for the cache Redis instance. The setup script only writes `REDIS_QUEUE_URL`, so the cache connector throws on first import (`WorkflowRecoveryService` → `getRedisCache`).
2. **Previously diagnosed (still pending):** `jwtAuth.ts` and `websocketManager.ts` read `SUPABASE_ANON_KEY`, but setup writes only `SUPABASE_PUBLISHABLE_KEY`.

This plan addresses both, since they share the same root cause (setup-script env template is incomplete) and the same files.

## Changes

### 1. `setup/setup.js` — backend `.env` template (around lines 336–361)
Add the missing variables so the backend boots out of the box:
- Add `REDIS_CACHE_URL=redis://localhost:6379` directly under the existing `REDIS_QUEUE_URL` line.
- Add `SUPABASE_ANON_KEY=${this.config.supabasePublishableKey}` under the `SUPABASE_PUBLISHABLE_KEY` line (legacy alias for code that still reads the old name).

### 2. `setup/setup.js` — market-stream `.env` template (lines 363–368)
- Add `REDIS_CACHE_URL=redis://localhost:6379` (the stream service shares the same Redis config module).

### 3. `coreza-backend/.env.example`
- Add `REDIS_CACHE_URL=redis://localhost:6379` next to `REDIS_QUEUE_URL`.
- Add `SUPABASE_ANON_KEY=` (empty) as a documented legacy alias.

### 4. `setup/validate.js` (lines 53–64)
- Add `REDIS_CACHE_URL` to the required-vars list for `coreza-backend/.env`.
- Keep `SUPABASE_PUBLISHABLE_KEY` as canonical; do not require `SUPABASE_ANON_KEY` (it's a fallback only).

### 5. Backend code — accept publishable key as primary, anon as fallback
Mirror the pattern already used in `coreza-backend/src/config/supabase.ts`:
- `coreza-backend/src/middleware/jwtAuth.ts` (lines 16–33): read `process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY`. Update the startup error message to mention `SUPABASE_PUBLISHABLE_KEY`.
- `coreza-backend/src/infra/websocketManager.ts` (all anon-key reads): same fallback pattern, update warnings to reference `SUPABASE_PUBLISHABLE_KEY`.

### 6. `docker-compose.yml`
- The `coreza-backend` service already passes `REDIS_CACHE_URL=redis://redis-cache:6379` ✅ — no change.
- Confirm `market-stream-service` already has it ✅ — no change.

## Out of scope

- No DB / migration changes.
- No frontend changes (frontend doesn't use Redis or anon-key fallback).
- No edge-function changes.
- No rename of `SUPABASE_ANON_KEY` references in the codebase — fallback is sufficient and preserves backward compatibility for existing self-hosters.

## Result

After re-running `node setup/setup.js`:
- Backend `.env` contains both `REDIS_QUEUE_URL` and `REDIS_CACHE_URL` → cache Redis initializes, no crash on `WorkflowRecoveryService` import.
- Backend `.env` contains both `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_ANON_KEY` → JWKS auth + WebSocket auth boot cleanly.
- `npm run dev` in `coreza-backend` starts successfully against a fresh Supabase project.
