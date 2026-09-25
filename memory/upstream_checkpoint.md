# Master Candle — Product and Integration Status

## User language and original requirements
- Respond to the user in Bengali only.
- Original request: exact frontend clone of https://github.com/developers0112-hue/Master-Candelv1, preserving UI/layout/animations/functionality.
- Current request: use ONLY the backend/system from https://github.com/developers0112-hue/Master-Candelv-backend.git. Do NOT replace the existing frontend with that repository's UI. Configure its environment and connect both Deriv and `market-qx-observer-v2`. User explicitly prioritizes careful repository inspection and extension compatibility.

## Existing architecture
- Frontend: React 19, TypeScript, Vite, Tailwind v4, base-ui; original UI retained. Do not migrate back to CRA/Tailwind v3 or replace UI primitives.
- Frontend market/trading/agent data currently MOCKED (static data/localStorage); no real-money execution.
- Backend: original FastAPI boilerplate at `/app/backend/server.py`, port 8001, MongoDB via protected `MONGO_URL` and `DB_NAME` settings.
- Frontend runs on supervisor-managed port 3000. Use current `REACT_APP_BACKEND_URL` from frontend environment, never previous fork URLs.
- No authentication or custom market API implemented.

## Current inspection — 2026-09-24
- User approved proceeding by reiterating the integration request and clarifying backend-only import.
- Cloned requested backend to `/tmp/master-candle-backend-source` for isolated inspection; no source UI or environment copied into running app.
- Verified remote branches/tags and both commits. Only `main`, HEAD `89f79b07a1f91d0d46e0518e2c2050b2a8e1bf6e`; current tree has 26 top-level files. Initial commit `33cde724b273` contains only README.
- BLOCKER: actual backend directories are absent: `src/`, `backend/`, `db/`, `database/`, `tools/`, `tests/`, and built `dist/`.
- `package.json` start points to missing `dist/src/server.js`; TypeScript config includes missing `src/**/*.ts` and `tests/**/*.ts`.
- Verified compiler failure: `TS18003: No inputs were found` with repository tsconfig.
- Extension `market-qx-observer-v2` is absent; older documented `tools/market-qx-observer` is also absent. Cannot determine or test extension protocol from actual source.
- `index.js` is only a standalone Deriv diagnostic, not an HTTP server; documentation explicitly confirms this distinction.
- Included historical reports describe TypeScript/PostgreSQL/Redis and secondary Python/SQLite systems, but associated source/migrations are missing. These reports are not proof of current working integration.
- Source `.env` exists but has invalid syntax starting at lines 82 and 103, a standalone `e` key without a value, and duplicate Deriv settings. Contains sensitive credential-like values in a public repository; values must not be printed, copied into frontend, or included in reports. Recommend rotation of any valid exposed credentials.
- Existing UI, backend, and protected environment settings are UNCHANGED. No new integration claimed working.

## Uploaded-artifact verification — 2026-09-24
- User supplied `backend` and `market-qx-observer-v2` attachments and asked to check and reply (no new implementation in this step).
- Asset metadata identifies both as public `application/octet-stream` files, not folder manifests.
- Downloaded both artifacts to `/tmp/master-candle-uploads/backend.upload` and `observer.upload`; both are exactly 0 bytes.
- Independently re-fetched both with Python requests and `Cache-Control: no-cache`: HTTP 200, `Content-Length: 0`, actual response body length 0 for BOTH artifacts. Links resolve, but there is no source content to inspect or extract.
- No source, extension manifest/scripts, or environment configuration can be recovered from empty files. Ask user to upload the actual folders as non-empty `backend.zip` and `market-qx-observer-v2.zip` (or populate the repository).
- Running frontend/backend and environment files remain untouched; integrations remain blocked. This is not a verified extension-code defect.

## Priorities / next actions
### Active user request — collecting backend files in batches
- User is sending five files at a time and currently asks only to note/retain them.
- Batch 1 received: `deriv-forwarder.log`, `anomaly_engine.py`, `db_manager.py`, `deriv_forwarder.py`, `deriv-forwarder.error.log`.
- All five downloads verified HTTP 200 and non-zero bytes. Full receipt ledger, sizes, and recoverable source URLs are in `/app/memory/backend_uploads.md`.
- Collection only; uploaded code has not been executed or integrated. Wait for remaining files before treating the backend/extension source as complete.

### P0 — blocked pending user files
1. Obtain complete backend source folders (`src/`, `backend/`, `db/`, `database/`, as applicable) from corrected repository or uploaded archive.
2. Obtain actual `market-qx-observer-v2` folder/archive, including manifest, background/content scripts, and settings.
3. Inspect actual contracts before choosing an integration architecture. Get mandatory integration playbooks for Deriv and extension transport before implementation; do not recreate undocumented backend logic and call it a clone.
4. Safely merge valid environment settings, preserving protected runtime/database keys and backend-only secrets. Never blindly overwrite current `.env` with malformed upstream file.
5. Connect both sources to current UI without redesign, then verify source isolation, market/candle mapping, freshness, extension CORS/transport, reconnects, and error states.
6. Major feature testing via testing agent and desktop/mobile smoke screenshots after implementation. Real extension compatibility requires actual extension source and an authorized browser session.

### P1
- User verifies preserved visual appearance and both connected data sources.
- Persistence implementation must use MongoDB under environment constraints; resolve repository PostgreSQL/SQLite boundaries only after complete source is available.

### P2 — not part of current request
- Favourite pairs, trade replay, agent offline alerts.

## Verification status
- Previous handoff reports desktop/mobile screenshots, but no testing-agent report for original clone.
- Current work: repository tree/history checks, entrypoint existence checks, safe dotenv syntax checks, and TypeScript compilation attempted; missing-source blocker confirmed.
- No integration implemented; Deriv and observer remain disconnected from current frontend.
- No app credentials created or modified.