# Master Candle — WORK STATUS / RESUME CHECKPOINT

If work stops (credits, connection), continue from the first unchecked item below.
Environment: React 19 + TS + Vite (`frontend/`, `yarn start`, DEV_PORT 3000) · FastAPI (`backend/server.py`, port 8001) ·
MongoDB (primary, `MONGO_URL`) · PostgreSQL mirror (Neon, `DATABASE_URL`) · Chrome extension `extensions/market-qx-observer-v2`.
Tests: `cd backend && python -m pytest -q` (27 tests) · `cd frontend && yarn typecheck && yarn lint`.
Docs: `README.md`, `memory/PRD.md`, `extensions/market-qx-observer-v2/LIVE_TEST_GUIDE.md`, this file.

## Completed (iterations 1-3)
- [x] 1:1 clone of methomia72-create/Master-Candel-Final_ ; Emergent dev plugins removed
- [x] PostgreSQL connection + `/api/health` postgres status (`backend/postgres_service.py`)
- [x] Observer + Deriv mirror to PostgreSQL, retention settings (`/api/v1/postgres/mirror`), analytics (`/api/v1/postgres/analytics`)
- [x] Feed health banner (stale >30s) with chime + browser notification; Analytics/Settings cards

## Iteration 4 — Live future-signal engine (user request, 2026-09-25)
User wants: real future signals (`EUR/USD · 1 Minute · 08:29 AM · CALL`) for BOTH sources (Deriv + QX observer) with a
source switch; timeframes 1m/5m/10m/30m/1h; multiple pairs at once; user-set confidence threshold (default 85%);
if no signal for 1h -> "deep scan" produces the best high-confidence candidate; NO fake data (stale/missing = NO_SIGNAL);
extension contract unchanged; UI polish (readability, smooth chart, activity animations); "is Quotex signal arriving" check.
Honest constraint: accuracy is MEASURED live (WIN/LOSS by next-candle close), never promised.
Real-money broker / Binance deposit-withdraw: NOT implemented (regulated activity, no keys) — Trade page stays a
virtual ledger driven only by live prices.

### Backend
- [ ] `backend/signal_engine.py` — confluence scoring over closed candles (EMA 9/21/50, RSI14, MACD, Bollinger, Stochastic,
      ATR regime, candle patterns, momentum, S/R proximity); returns direction/confidence/votes; deep-scan variant with
      higher-timeframe confirmation. Pure functions, unit-testable.
- [ ] `backend/signal_service.py` — worker: every 5s evaluate fresh (source,symbol,tf), one signal per entry epoch,
      entry = next candle start, expiry = entry+tf; verification of PENDING signals; deep scan after N minutes idle;
      settings persisted in Mongo `runtime_settings` id `signal_engine`; collections `live_signals`.
- [ ] `backend/signal_routes.py` — `GET /api/v1/signals/live`, `GET /api/v1/signals/stats`, `GET /api/v1/signals/check`,
      `GET/POST /api/v1/signals/settings`, `POST /api/v1/signals/scan` (manual deep scan).
- [ ] Add `10m`, `15m`, `30m`, `1h` to `MARKET_TIMEFRAMES` in `backend/.env` (store buckets + analysis)
- [ ] Wire into `server.py` lifespan; pytest for engine + routes

### Frontend
- [ ] `lib/signalSource.ts` — global source switch (Deriv / QX observer / Both) in localStorage
- [ ] `components/terminal/FutureSignals.tsx` — Home right panel board in requested format with countdown, confidence, mode
- [ ] `components/terminal/SignalTracker.tsx` — Signals page: history table (WIN/LOSS/TIE/PENDING), accuracy stats
- [ ] `components/terminal/SignalSettings.tsx` — Settings: threshold slider, timeframes, deep-scan minutes, sources
- [ ] `components/terminal/QuotexCheck.tsx` — "Quotex signal arriving?" verification card (feed, pairs, candles/tf, last signal)
- [ ] Chart: smooth candle transitions (CSS/SVG), engine heartbeat animation, readability (font-size/contrast bump)
- [ ] Timeframe buttons include 10m/30m/1h where the source has data

### Verification
- [ ] pytest green; backend testing agent; frontend testing agent (ask user); screenshots
