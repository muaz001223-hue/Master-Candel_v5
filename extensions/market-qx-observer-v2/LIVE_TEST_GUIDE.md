# market-qx-observer-v2 — Live test guide (end to end)

Goal: load the extension in Chrome, point it at this backend, open market-qx.info
(or *.quotex.com) and confirm the terminal switches the QX observer module from
`WAITING_FOR_EXTENSION` to `DATA_RECEIVING` (Home shows `OBSERVING`).

## 0. Values you need

| Value | Where |
|-------|-------|
| Backend origin | `frontend/.env` → `REACT_APP_BACKEND_URL` (HTTPS origin only, no path) |
| Service key | `backend/.env` → `OBSERVER_SERVICE_KEY` |

Never paste the key anywhere other than the extension options page.

## 1. Download and load the extension

1. In the terminal UI open **Settings → Connections** and click *Download observer*,
   or open `<backend origin>/api/v1/observer/download` directly.
2. Unzip → folder `market-qx-observer-v2/` (manifest already lists this backend
   origin under `optional_host_permissions`).
3. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select the unzipped folder.
4. The extension appears as *Market-QX Visible Market Observer v2* (v1.1.0) with
   no errors. If Chrome shows a manifest warning, re-download; do not edit files.

## 2. Configure the connection

1. Click the extension icon → options page opens.
2. **Backend origin**: paste `REACT_APP_BACKEND_URL` exactly (e.g.
   `https://your-host.example`). HTTPS is required unless localhost.
3. **Service key**: paste `OBSERVER_SERVICE_KEY`.
4. Leave **Selectors** as `{}` for the default `data-symbol`/`data-price` probes,
   or paste a JSON object of CSS selector arrays for the real visible fields.
5. Click **Save** → Chrome asks to grant the backend origin → **Allow**.
6. Click **Test connection** → expected `Backend and service key verified.`
   (backend `GET /api/v1/observation/check` returned 200).
   * `Connection rejected (HTTP 401)` → wrong key (compare with `backend/.env`).
   * `Failed to fetch` → wrong origin, permission not granted, or backend down
     (check `<origin>/api/health`).

## 3. Produce observations

1. Open https://market-qx.info/ (or your Quotex tab) and log in normally.
2. Reload the tab once so the content script (`parser.js` + `content.js`) runs at
   `document_idle`.
3. Watch the **Status** box on the options page (live updates):
   * `CONNECTED` — events accepted by the backend.
   * `DOM_UNAVAILABLE` — pair/price fields were not found. Add exact selectors
     for the *visible* pair name and price (not balances, timers or containers)
     and reload the tab. Canvas-only prices cannot be read.
   * `AUTHENTICATION_REQUIRED` — key mismatch.
   * `RECONNECTING` / `RETRY_LIMIT_REACHED` — transport issue; queue is retried
     every 30 s via alarms, capped at 500 events, stale events (>120 s) dropped.
   * `EVENT_REJECTED HTTP_422` — validation failure (stale/out-of-order tick,
     invalid OHLC, unsupported timeframe). Nothing is fabricated.

## 4. Confirm end to end

1. `GET <origin>/api/v1/observation` → `state: DATA_RECEIVING`, `ageSeconds < 30`.
2. `GET <origin>/api/v1/runtime` → provider `market-qx-observer-v2` = `DATA_RECEIVING`.
3. Terminal **Home** → *System monitor* → **DashboardRelay / WS** card shows
   `OBSERVING`; select an **OTC** pair in the instrument rail → chart state `LIVE`.
4. `GET <origin>/api/health` → `postgres.mirror.rows.observer_ticks` grows: every
   accepted tick/candle is stored in MongoDB (`market_ticks`, `market_candles`)
   and mirrored to PostgreSQL (`observer_ticks`, `observer_candles`).
5. If no data arrives for 30 s the terminal shows the **feed health banner**
   ("QX observer feed stale") and the module returns to `WAITING`/`STALE`.

## 5. Payload contract (for manual verification without a browser)

Headers: `Content-Type: application/json`, `X-Market-QX-Key: <service key>`

```json
POST /api/v1/observation/pairs
{"source":"MARKET_QX_BROWSER_OBSERVATION","schema_version":2,"session_id":"S1","dedupe_id":"P1",
 "observationMethod":"visible-dom-only","pairs":[{"symbol":"EUR/USD (OTC)","providerSymbol":"EUR/USD (OTC)","timeframe":"1m"}]}

POST /api/v1/observation/tick
{"source":"MARKET_QX_BROWSER_OBSERVATION","schema_version":2,"session_id":"S1","dedupe_id":"T1",
 "observationMethod":"visible-dom-only","symbol":"EUR/USD (OTC)","providerSymbol":"EUR/USD (OTC)",
 "price":1.08512,"timeframe":"tick","timestamp":"<now ISO-8601 UTC, e.g. 2026-09-25T01:20:00.000Z>"}
```

Both return `{"ok":true,"duplicate":false,...}`; repeating the same `dedupe_id`
returns `duplicate: true`. Observed data is always labelled
`BROWSER_OBSERVED_UNVERIFIED` and never mixed with the Deriv source.
