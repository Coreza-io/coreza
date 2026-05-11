
# Simple Windows `setup.exe` launcher — runs setup, then boots everything

## Goal
A single double-clickable `setup.exe` at the repo root that:
1. Runs `node setup/setup.js` (existing logic — installs deps, configures `.env`, migrations, etc.).
2. After setup succeeds, **starts all three dev servers** and **opens the frontend in the default browser**.

The `.exe` stays a thin launcher; no business logic moves into it.

## Approach: tiny Go launcher

Same rationale as before — ~2 MB static PE binary, no runtime, easy CI cross-compile from Linux. Alternatives (`pkg`, `ps2exe`, Bat2Exe, Node SEA) bring runtime bloat or AV/SmartScreen problems.

## Launcher behavior (what `setup.exe` does, in order)

1. **Resolve repo root** = directory containing `setup.exe`. `chdir` there.
2. **Check `node` is on PATH.** If missing → print Node.js LTS download URL, `pause`, exit 1.
3. **Run setup**: spawn `node setup\setup.js` with inherited stdio so existing readline prompts work unchanged. Wait for exit. If non-zero → `pause`, exit with same code.
4. **Detect first-run vs re-run**: if user passes `--setup-only` flag (or double-clicks while holding Shift — optional, skip), stop here. Otherwise continue.
5. **Launch the three services**, each in its **own new console window** so logs are separated and a user can close one without killing the others. On Windows this is done via `cmd /c start "<title>" cmd /k "<command>"`:
   - Window title `Coreza Frontend` → `cmd /k "npm run dev"` in repo root.
   - Window title `Coreza Backend` → `cmd /k "npm run dev"` in `coreza-backend\`.
   - Window title `Coreza Market Stream` → `cmd /k "npm run dev"` in `coreza-backend\market-stream-service\`.
6. **Wait for the frontend to be reachable.** Poll `http://localhost:8080` (or whatever port `vite.config.ts` uses — read it from the file at launch time, fallback `5173`) every 500 ms for up to 60 s.
7. **Open the browser** to the frontend URL via `rundll32 url.dll,FileProtocolHandler <url>` (the standard Windows "open default browser" call).
8. Print a summary in the launcher window:
   - Frontend: http://localhost:<port>
   - Backend:  http://localhost:8000
   - Market stream: ws://localhost:8090
   - "Close any of the three console windows to stop that service. Re-run setup.exe to start again."
9. `pause` so the launcher window stays open for the user to read.

### Re-run UX
On subsequent double-clicks `setup/setup.js` already detects existing `.env` and skips re-prompting (it loads existing credentials). So a re-run effectively becomes "validate + relaunch servers" — no extra flag plumbing required. We rely on the existing setup.js behavior; no changes to it.

### Optional flags (nice-to-have, low cost)
- `setup.exe --setup-only` → stop after step 3.
- `setup.exe --start-only` → skip setup, jump straight to step 5 (for users who just want to relaunch services).
- `setup.exe --no-browser` → skip step 7.

## Files added

- `installer/launcher/main.go` — ~80 lines of Go covering the steps above.
- `installer/launcher/go.mod`
- `installer/launcher/icon.ico` — Coreza icon.
- `installer/launcher/versioninfo.json` — Windows file properties (ProductName "Coreza Setup & Launcher", company, version) embedded via `goversioninfo`.
- `.github/workflows/build-launcher.yml` — Go setup, `go generate` for icon/versioninfo embedding, cross-compile:
  ```
  GOOS=windows GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o setup.exe ./installer/launcher
  ```
  Upload as workflow artifact and attach to GitHub Releases on tag pushes. Do **not** use `-H=windowsgui` — we want the console visible.
- Optionally commit the built `setup.exe` at repo root so a fresh `git clone` is immediately double-clickable, with CI verifying it stays in sync.

## Documentation

Update `docs/SETUP.md` Quick Setup section:

> **Windows users:** double-click `setup.exe` in the repo root. It runs the setup wizard, then opens three console windows (frontend, backend, market-stream) and launches the app in your default browser. Make sure Node.js 18+ is installed first (https://nodejs.org).
>
> Re-running `setup.exe` later just relaunches the servers (setup is skipped if already configured). Pass `--start-only` to skip the setup check, or `--setup-only` to reconfigure without launching.

## Out of scope
- No wizard UI, no prerequisite auto-install, no Inno Setup.
- No changes to `setup/setup.js` itself.
- No process-supervision/restart logic — closing a console window stops that service, by design.
- No code signing yet (CI hook can be added later when a cert is available).

## Result
One ~2 MB `setup.exe` at repo root. Double-click → setup runs (or skips if already configured) → three labeled console windows appear with the dev servers → browser opens to the frontend automatically.
