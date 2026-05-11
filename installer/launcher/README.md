# Coreza Setup & Launcher (`setup.exe`)

A tiny (~2 MB) Windows launcher that:

1. Runs `node setup/setup.js` (interactive — the existing setup wizard).
2. Spawns the three dev servers in their own labeled console windows:
   - **Coreza Frontend** (`npm run dev` in repo root, port 8080)
   - **Coreza Backend** (`npm run dev` in `coreza-backend/`, port 8000)
   - **Coreza Market Stream** (`npm run dev` in `coreza-backend/market-stream-service/`, port 8090)
3. Detects the frontend port from `vite.config.ts` (fallback `5173`), waits for the frontend to respond, then opens `http://localhost:<detected-port>` in the default browser.

## Usage

If `setup.exe` is not already present at repo root, download it from the latest GitHub Release (or build it using the command below), then place it at the repository root (next to `package.json`) and double-click it.

Flags:

| Flag | Effect |
|---|---|
| `--setup-only` | Run the setup wizard, then exit (don't launch services). |
| `--start-only` | Skip the setup step; just launch services. |
| `--no-browser` | Don't open the browser at the end. |

## Build

Cross-compile from any OS with Go 1.21+:

```bash
cd installer/launcher
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -ldflags="-s -w" -o ../../setup.exe .
```

CI builds it automatically on every tag push (`.github/workflows/build-launcher.yml`)
and attaches it to the GitHub Release.

## Optional: Windows file properties

Before `go build`, run:

```bash
go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest
goversioninfo -platform-specific=true -o resource_windows_amd64.syso versioninfo.json
```

The CI workflow already does this whenever `versioninfo.json` is present.
