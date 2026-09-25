# Master Candle — Backend integration checkpoint

## লক্ষ্য / Goal
বর্তমান Master Candle UI-এর design, size, layout ও visual language অক্ষত রেখে
Deriv এবং `market-qx-observer-v2` থেকে বাস্তব, source-isolated market data নিয়ে
binary/forex/OTC analytical system তৈরি করা। কোনো real-money execution নেই।
“Ultra/advanced” একটি লক্ষ্য; verified accuracy বা লাভের নিশ্চয়তার দাবি নয়।

## বর্তমান অবস্থা — 2026-09-24
**প্রথম integration পর্যায় বাস্তবায়িত; পূর্ণ testing চলমান। সব ১১টি subsystem সম্পূর্ণ নয়।**

- FastAPI + MongoDB চালু; Vite/React19/Tailwind-v4 UI বজায় আছে।
- Deriv **new Options public WebSocket**: symbols, live ticks, closed OHLC history,
  automatic reconnect/keepalive. Account token বা authorize request পাঠায় না।
- `.env`-এর বৈধ settings merge করা হয়েছে; invalid lines বাদ, duplicate Deriv
  settings-এ শেষ assignment রাখা হয়েছে। Protected settings মুছে দেওয়া হয়নি।
- দুই source-এর instrument/tick/candle আলাদা; OTC suffix হারায় না।
- Observer ingress: service-key verification, schema validation, timestamp/OHLC
  checks, persistent deduplication. Extension না থাকলে WAITING, fake data নয়।
- Original repository-এর FeatureEngine, DataQualityEngine, MarketBehaviorEngine,
  AdaptiveHorizonSelector ও BinarySignalEngine reusable অংশ চালানো হচ্ছে।
- `ta` library দিয়ে trend/momentum/volatility indicator **outputs** গণনা; real
  volume না থাকলে volume indicators অনুপস্থিত, বানানো volume নয়।
- Quality-ranked top 15 candidates ও analytical signal history সংরক্ষণ।
- Main screen-এ backend data/status, actual analysis request, UTC chart data।
- Trade screen এখনও **MOCKED** virtual-funds/localStorage simulation।

## Repository scan / canonical source
Source: https://github.com/developers0112-hue/dd.git
Commit: `7568d8af3fed6c6a7da02efe23d1d7ce3414df4f`

86টি flattened file; মূল folder structure নেই। Python debugging utilities,
compiled JS analytical engines, extension, SQL migrations ও SQLite মিশ্রিত।
`deriv-forwarder.error.log` ও `deriv-runtime.error.log` একেবারে duplicate।
Python `.pyc` এবং logs runtime-এ নেওয়া হয়নি। পুরোনো source UI-ও নেওয়া হয়নি।

**এখনো source-এ নেই:**
`agents/{registry,orchestrator,specialized,catalog}.js`,
`database/{client,repositories,migrator}.js`। তাই upstream `server.js`
অপরিবর্তিতভাবে চালানো যায় না। মূল Python `server.py` শুধু frame logger।
Existing FastAPI entrypoint-এ adapter বসানো হয়েছে; PostgreSQL/Redis/SQLite
runtime খোলা হয়নি। Archival SQL/reference files `reference/dd/`-এ আছে।

## আপনার ১–১১ নম্বর subsystem
| নাম | বর্তমান সত্যিকারের অবস্থা |
| --- | --- |
| **500 Agents** — Tracking All Pairs/Candles | 500 configured slots; 0 implemented agents. Source missing, fabricated telemetry নয় |
| **Pipeline** | Market data → stored candles → original features/quality/behavior → indicators → guarded signal |
| Pattern Detection Engine / Chart Analysis Engine | Original rule-based candle/feature analysis |
| **50+ Indicator Engine** | Library-derived outputs; count data-dependent, not 50 independently trained models |
| Quality Definition / Candle Type Tracking / Quality Pipeline Engine | OHLC/timestamp/gap/freshness checks and original candle pattern candidates |
| **Behaviour Finder** | Original 7 rule-based detectors; evidence remains unverified |
| **Algorithm Detection** | Not implemented; do not claim detecting a broker’s hidden algorithm |
| Top 15 Quality **pair Detection** | Fresh 1m histories ranked by data quality/sample count, not win probability |
| **Breakout & Gap Up/Down Detection** | Original false-break candidates + observed price gaps; predictive validation pending |
| **Master Agent** | Original fail-closed signal gates, currently NO_SIGNAL |
| **Self-Training System** | Not trained; labeled datasets, OOS/walk-forward/calibration still needed |
| Complete **Trade History** | Analytical decisions stored; real executions absent, demo trades remain browser-local |
| Final Pair Selection for Signal **Generation** | Data-quality candidates available; final qualified selection blocked |
| Greatest **Module** for Signal Output | Analytical API/UI connected; CALL/PUT not forced through invalid gates |

## Structure
```
frontend/src/pages/Home.tsx               existing UI + live bindings
frontend/src/pages/Trade.tsx              unchanged MOCKED demo mode
frontend/src/hooks/useMarketBackend.ts    typed API data hooks
backend/server.py                        FastAPI lifecycle + API wiring
backend/market_config.py                 environment-only configuration
backend/deriv_service.py                  new public Deriv protocol
backend/market_store.py                   source-isolated MongoDB storage
backend/market_models.py                  schemas/validation
backend/market_auth.py                    observer service-key verification
backend/observation_routes.py             compatible observer ingress
backend/market_analysis.py                indicators + bounded engine bridge
backend/analysis_worker.mjs               Node stdio bridge (no extra port)
backend/vendor/*.mjs                      reusable original JS engines
backend/market_routes.py                  runtime/market/analysis/history API
backend/import_legacy.py                  idempotent archival SQLite extraction
extensions/market-qx-observer-v2/          corrected extension package
reference/dd/                            original source reference (not runtime)
memory/PRD.md                            complete continuation context
memory/test_credentials.md               private service credential reference
PROJECT_STATUS.txt                       plain-text continuation checkpoint
```

## Environment / service operation
Keep frontend `REACT_APP_BACKEND_URL`, backend `MONGO_URL` and `DB_NAME` unchanged.
Frontend uses only the public backend URL, exposed through Vite `define`.
Backend remains supervisor-managed on 8001; frontend on 3000. All external
backend HTTP routes have `/api`. Node engines use stdio, not another server port.

New required backend settings: `PUBLIC_APP_URL`, `MARKET_TIMEFRAMES`,
`MARKET_FRESHNESS_SECONDS`, `ANALYSIS_INTERVAL_SECONDS`,
`INGESTION_KEY_SHA256`, `OBSERVER_SERVICE_KEY`. Connection values are in `.env`,
never in React. Original third-party secret values are not sent to Deriv.
Any valid secrets exposed in the upstream public repository should be rotated.

Install backend dependencies from `backend/requirements.txt`; frontend via
`yarn install`. Build UI: `cd frontend && yarn build`. Normal changes hot-reload.
Environment/dependency changes: `sudo supervisorctl restart backend` or frontend.
Do not start an extra uvicorn process. Do not restore old hardcoded ports.

## Extension setup
1. Download `/api/v1/observer/download`, extract ZIP.
2. Chrome extensions → Developer mode → Load unpacked → extracted folder.
3. Open extension options. Backend URL = frontend `.env`'s
   `REACT_APP_BACKEND_URL` (origin only, no `/api` suffix).
4. Service key = backend `.env` `OBSERVER_SERVICE_KEY`. Never put it in the app
   frontend, repository, public ZIP, URL query or screenshots.
5. Save, allow the backend origin, then Test connection.
6. Open an authorized `market-qx.info` / supported Quotex tab. Only explicit
   visible selectors are read. Add actual DOM selectors in options if needed.

The original extension guessed arbitrary numbers, lost OTC suffixes, fabricated
one-minute candle times and targeted localhost:4000. The integrated version
removes those behaviors. It does NOT intercept private WebSockets, read broker
cookies/tokens, bypass login or manufacture canvas-only prices.

**Live broker DOM compatibility remains unverified without the real authorized
provider tab.** Missing selectors produce DOM_UNAVAILABLE instead of wrong data.
Raw observed ticks use receipt timestamps explicitly; closed DOM candles require
visible source timestamps/timeframes and an explicit closed marker.

## API
- `GET /api/health`, `/api/v1/runtime`, `/api/v1/modules`, `/api/v1/instruments`
- `GET /api/v1/market/state?source=deriv&symbol=EUR%2FUSD&timeframe=1m`
- `POST /api/v1/analysis` with `{source,symbol,timeframe}`
- `GET /api/v1/analysis/latest`, `/api/v1/top-pairs`, `/api/v1/history`, `/api/v1/events`
- `GET /api/v1/observation` — observed-data status, no credentials
- `GET /api/v1/observation/check` — requires `X-Market-QX-Key`
- `POST /api/v1/observation/pairs`, `/tick`, `/event` — requires same key
- `GET /api/v1/observer/download` — key-free ZIP

Observation messages preserve `MARKET_QX_BROWSER_OBSERVATION` and original
symbol/price/OHLC fields, adding `session_id`, `dedupe_id`, `schema_version:2`.
Supported initial candle intervals: 1s, 5s, 15s, 1m, 5m. Sub-minute bars come
only from received ticks and are explicitly partial coverage.

## Persistence and source integrity
Mongo collections: market_instruments, market_ticks (2-day TTL), market_candles,
market_analyses, signal_history, observer_receipts (7-day TTL), observer_status,
runtime_events. Identity includes source + symbol + timeframe + epoch.

SQLite snapshot: 296 candles + 2 signals imported into
`legacy_candles_unverified` / `legacy_signals_unverified` only. `trainingEligible`
is false. Re-import via `python backend/import_legacy.py` is idempotent.
No historic record is presented as a current broker quote or verified outcome.

## Next actions / remaining work
**P0:** Complete verification and fix test findings. Confirm actual observer DOM
selectors in user's authorized browser. Supply missing agent modules or explicitly
implement/version/test replacements; do not count empty slots as live agents.
**P1:** Provenance-tracked outcome collection, real algorithm research,
self-training, temporal OOS/walk-forward validation, calibration and risk gates;
then qualified pair selection and signals. Add server-backed demo trade ledger
without confusing it with real execution. Broader dynamic market catalog.
**P2:** Replay, favourites, offline alerts.

No credit/internet interruption is detectable in advance: this README,
PROJECT_STATUS.txt and memory/PRD.md are the continuation checkpoints. Check the
latest test report and checkpoint before declaring any task complete.