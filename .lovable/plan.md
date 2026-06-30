# Dhan Live Market Feed — 1006 After Subscribe: Root-Cause Analysis & Fix Plan

## Symptom
- Socket upgrade to `wss://api-feed.dhan.co` succeeds (`Gateway connected`).
- Connection stays **stable while idle** (observed up to ~273s / 4.5 min).
- ~3–6s **after the subscribe frame is sent**, Dhan raw-TCP-drops the socket:
  `code 1006 - No reason provided` (abnormal closure, no application-level close frame, no Dhan `50` disconnect packet).
- Reconnect loop retries (attempt N/5) and repeats.

## What has been PROVEN correct (ruled out)
End-to-end verification across the pipeline shows every value Dhan needs is correct:

1. **WS URL host & params** — `wss://api-feed.dhan.co?version=2&token=<JWT>&clientId=<id>&authType=2`
   (`getDhanWsUrl` / `environment.ts`). Matches Dhan v2 spec exactly.
2. **Token = JWT** — `resolveDhanMarketToken` returns `creds.api_key`, which is the **same JWT value** used (and working) as the `access-token` header for Dhan REST trading calls (`dhan/http/config.ts`). So the token field is correct, not a mix-up with client_id.
3. **clientId** — populated and sent.
4. **Payload** — user screenshot confirms:
   `{ "RequestCode": 21, "InstrumentCount": 1, "InstrumentList": [{ "ExchangeSegment": "NSE_EQ", "SecurityId": "1333" }] }`
   RequestCode 21 (Full) is documented/valid; SecurityId is numeric (`1333`, not the symbol); exchange enum correct.
5. **Wire format** — Dhan market frames are sent as **JSON text frames** via `JSON.stringify` (`isBinary` is false), matching Dhan's "subscribe = JSON, responses = binary" contract.
6. **Idle stability** — survives minutes idle → rules out auth failure, ping/pong timeout, and URL/token-at-connect rejection.

**Conclusion:** This is a **Dhan server-side rejection that fires only at subscription time**, not a bug in our payload-building or send path.

## External corroboration (research)
- DhanHQ-py issue #75: confirms async-vs-sync usage, not our case (we run the receive loop). Not the cause.
- madefortrade "Websockets keep getting closed": multiple users hit 1006/1011 from Dhan; Dhan staff acknowledged **server-side instability** and that fixes were rolled into v2. Their drops are 10–20 min (keepalive), which is a *different* (also-real) issue.

## Most likely remaining causes (in priority order)
1. **Token lacks Data API feed entitlement.** Dhan's feed JWT must be generated with **Data APIs enabled** in the Dhan dashboard. A trading-only token authenticates the socket *upgrade* but is rejected the moment a market subscription is requested → exactly "upgrade OK, idle OK, drop right after subscribe." (User earlier saw "DhanLive / Dhan Cloud" data entitlements as Inactive/Expired.)
2. **Concurrent WS connection limit hit.** Dhan allows a small number of simultaneous feed connections per clientId. The earlier reconnect storms + multiple dev restarts can exhaust the quota; new sockets are accepted then dropped at subscribe.
3. **Dhan server-side instability** (documented), usually longer-lived than seconds.

We cannot distinguish #1/#2 from generic noise inside the full pipeline. The plan below adds **decisive diagnostics** and an **isolated probe** to confirm, plus low-risk hardening.

---

## Plan

### Step 1 — Surface the HTTP upgrade response (the smoking gun)
File: `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts`
- Add a `this.ws.on('unexpected-response', (req, res) => …)` handler in `connect()` that logs `res.statusCode`, `res.statusMessage`, and the response body.
  - **401/403 here = token/entitlement problem (cause #1).** This is the single most valuable signal and we currently don't log it.

### Step 2 — Add subscribe-relative timing to the close handler
File: same.
- Add private fields `connectionOpenedAt` and `lastSubscribeSentAt`.
- Set `connectionOpenedAt = Date.now()` in the `open` handler.
- Set `lastSubscribeSentAt = Date.now()` whenever a subscribe payload is sent (in the send path used by `resubscribeAll`).
- In the `close` handler, log `uptimeMs = now - connectionOpenedAt` and `msSinceSubscribe = now - lastSubscribeSentAt`.
  - A consistently small `msSinceSubscribe` confirms "subscribe triggers the drop" (cause #1/#2), vs large uptime with no recent subscribe (keepalive instability, cause #3).

### Step 3 — Standalone isolation probe (no pipeline, no Redis, no app)
New file: `coreza-backend/market-stream-service/scripts/dhan-feed-probe.ts`
- Reads `DHAN_CLIENT_ID` and `DHAN_ACCESS_TOKEN` from env.
- Opens `wss://api-feed.dhan.co?version=2&token=…&clientId=…&authType=2`.
- Logs `unexpected-response` (status + body), `open`, every binary message length, and `close` (code, reason, elapsed since open, elapsed since subscribe).
- On open, waits ~1s then sends **RequestCode 15 (Ticker)** for `{ ExchangeSegment: "NSE_EQ", SecurityId: "1333" }` (Ticker is the lightest entitlement; if even 15 drops, it is almost certainly entitlement/quota, not mode).
- Optional `--full` flag to retry with RequestCode 21.
- Run: `npx ts-node scripts/dhan-feed-probe.ts` (or `bun`).
- **Interpretation:**
  - 401/403 at upgrade → enable Data APIs / regenerate token (cause #1).
  - Upgrade OK + drop after ticker subscribe → entitlement or connection-limit (cause #1/#2); verify dashboard + close stale sockets.
  - Ticker works but Full drops → mode/entitlement on Full only; default live nodes to Ticker/Quote.
  - Stable for minutes then drops with no recent subscribe → keepalive instability (cause #3); align keepalive to Dhan's 10s cadence.

### Step 4 — Low-risk hardening (apply regardless)
- Throw/skip in `buildDhanMarketMessages` if a resolved `SecurityId` is non-numeric (defensive; already verified numeric, but prevents silent bad payloads on future symbols).
- Promote `buildDhanSubscribeMessage` payload log from `debug` → `info` so the exact RequestCode + instruments are visible in normal logs.
- Reconnect backoff: do **not** auto-reconnect after repeated subscribe-triggered 1006s within a short window (avoids burning the connection quota → cause #2 self-inflicted). Treat N consecutive subscribe-drops as fatal and emit a control record instead of looping.

### Step 5 — Mirror to backend repo
- Apply the same `unexpected-response` + timing diagnostics to any equivalent gateway in `coreza-backend/src` (order-update path) and keep `dhan/ws/helpers.ts` in sync.

---

## Decision needed from user (account-side, cannot be fixed in code)
The code is correct; the next move depends on probe output. Most likely action:
- In the Dhan dashboard / developer portal, confirm **Data APIs (market feed)** entitlement is **Active** for the access token in use, and regenerate the token if it shows Inactive/Expired.
- Ensure no other app/session is holding Dhan feed connections (connection-limit).

Start with **Steps 1–3** to get a definitive signal, then apply Step 4 hardening and the account fix indicated by the probe.
