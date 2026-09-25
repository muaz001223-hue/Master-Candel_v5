# Master Candle

মূল রিপোজিটরি: https://github.com/methomia913-glitch/Master-Candel-Main

## বর্তমান অবস্থা — 2026-09-24

মূল Home/Trade ডিজাইন রেখে অ্যাপ চালু এবং পরীক্ষিত। এটি **React 19 + TypeScript + Vite 8 + Tailwind 4**, **FastAPI**, **MongoDB** প্রজেক্ট; root-level Node `index.js` সার্ভার নয়। Node ব্যবহৃত হয় মূল analytical engines-এর stdio worker-এ। PostgreSQL/Redis এই অ্যাপের runtime dependency নয়।

### সম্পন্ন
- বর্তমান পরিবেশে frontend/backend/MongoDB চালু; production frontend build সফল।
- Deriv public WebSocket থেকে প্রকৃত ticks ও candle history; reconnect এবং accepted/rejected/pending stream diagnostics। শেষ live যাচাইয়ে 32টি subscribed instrument-এ ডেটা পাওয়া গেছে; সংখ্যা provider availability অনুযায়ী বদলাতে পারে।
- Source-isolated OHLC, data-quality, indicator output, analytical history, top-15 quality ranking; যাচাইবিহীন ডেটায় fail-closed `NO_SIGNAL`।
- মূল Signals / Analytics / Flow map / Logs / Settings বোতাম এখন আলাদা data-backed পাতায় যায়। Refresh, CSV export, observer ZIP download কাজ করে।
- Trade স্ক্রিনের ভার্চুয়াল হিসাব এখন MongoDB-তে সংরক্ষিত। Server-side validation, idempotent action, concurrent balance protection, pending order, expiry settlement ও reset archive যুক্ত। UI layout ও একই deterministic demo pricing রাখা হয়েছে।
- মোবাইল মেনু দিয়ে সব নতুন পাতায় যাওয়া যায়; 320/390/768px document overflow পরীক্ষিত।
- নতুন `.env.example`, idempotent setup script, বর্তমান origin অনুযায়ী extension package; observer key নতুন করে তৈরি। `.env` ও credential files Git থেকে বাদ।
- পুরোনো SQLite-এর 296 candles ও 2 signals শুধু `legacy_*_unverified` collection-এ রাখা হয়েছে; live/training input নয়।

### গুরুত্বপূর্ণ সীমাবদ্ধতা
**সব ১১টি subsystem সম্পন্ন নয়।** মূল source-এ 500 specialized agent, registry/orchestrator implementation, trained model এবং validation dataset নেই। এগুলোকে কাজ করছে বলে দেখানো হয়নি।

- `500 Agents`: configured slots আছে; **0 implemented**।
- Self-training/calibration: **NOT_TRAINED**; প্রকৃত outcome dataset, temporal OOS/walk-forward tests প্রয়োজন।
- Broker hidden algorithm detection: **NOT_IMPLEMENTED**; কোনো এমন দাবি নেই।
- QX browser observer API/parser/transport প্রস্তুত; প্রকৃত অনুমোদিত broker tab/DOM selectors ছাড়া live compatibility নিশ্চিত নয়। Extension না থাকলে **WAITING_FOR_EXTENSION**, OTC-তে অন্য source-এর quote বসানো হয় না।
- Trade হলো **simulated market + virtual funds**, real broker execution বা payment নয়। Storage বাস্তব MongoDB; ফলাফল live-market evidence নয়।
- Demo account browser-এর private cookie দ্বারা চিহ্নিত। Cookie মুছলে/মেয়াদ শেষ হলে পুরোনো account-এর access থাকবে না; cross-device login/recovery এই সংস্করণে নেই।

## ফাইল ও সেবা

```text
backend/server.py                    FastAPI entrypoint / lifecycle
backend/deriv_service.py             Public Deriv stream/history
backend/market_store.py              Source-isolated Mongo persistence
backend/market_analysis.py           Indicators and Node-engine bridge
backend/demo_engine.py              Deterministic virtual trading rules
backend/demo_routes.py              Private demo session / atomic ledger API
backend/demo_catalog.json           Generated SIMULATED catalog snapshot
frontend/src/pages/Home.tsx         Preserved analytical terminal
frontend/src/pages/Trade.tsx        Preserved demo terminal, server-saved ledger
frontend/src/pages/Workspace.tsx    Signals/analytics/modules/logs/connections
extensions/market-qx-observer-v2/   Visible-DOM observer
scripts/setup_runtime.py            Add missing environment settings safely
scripts/export_demo_catalog.mjs     Regenerate demo catalog from preserved TS data
memory/PRD.md                       Current requirements and remaining tasks
PROJECT_STATUS.txt                  Short continuation checkpoint
```

## ধাপে ধাপে setup

### 1. পরিবেশ
চলমান `.env` overwrite করবেন না। নতুন পরিবেশে উদাহরণ ফাইল থেকে তৈরি করে আপনার ঠিকানা/ডেটাবেস বসান:

```bash
# কেবল fresh installation; আগে থেকে .env থাকলে এই ধাপ বাদ দিন
test -f backend/.env || cp backend/.env.example backend/.env
test -f frontend/.env || cp frontend/.env.example frontend/.env
```

- `backend/.env`: `MONGO_URL`, `DB_NAME`, `PUBLIC_APP_URL`, `CORS_ORIGINS`, Deriv URL/symbols, timeframes, freshness ও analysis interval।
- `frontend/.env`: `REACT_APP_BACKEND_URL` = বর্তমান public origin; `DEV_PORT` = frontend service port।
- `PUBLIC_APP_URL` ও frontend URL একই origin রাখুন।
- বিদ্যমান protected Mongo/backend URL অপরিবর্তিত রাখুন।
- Deriv public market data-তে broker token/API key প্রয়োজন নেই।

### 2. প্যাকেজ ও setup

```bash
python -m pip install -r backend/requirements.txt
cd frontend && yarn install --frozen-lockfile && cd ..
python scripts/setup_runtime.py
node scripts/export_demo_catalog.mjs
python backend/configure_extension.py
```

অব্যবহৃত LLM integration-এর conflicting pinned packages runtime requirements থেকে বাদ দেওয়া হয়েছে; এই অ্যাপ LLM ব্যবহার করে না। Frontend catalog পাল্টালে export command পুনরায় চালান।

Observer key বদলাতে `python scripts/setup_runtime.py --rotate-observer`। এরপর backend restart এবং extension options-এ নতুন key দিন। Script কোনো secret print করে না। Public upstream repository-তে প্রকাশিত অন্য কোনো বৈধ secret থাকলে সংশ্লিষ্ট provider থেকে revoke/rotate করুন; সেগুলো live Deriv request-এ ব্যবহার করা হয় না।

### 3. বিদ্যমান process manager

```bash
sudo supervisorctl restart backend frontend
sudo supervisorctl status
cd frontend && yarn build
```

Backend supervisor-managed `0.0.0.0:8001`; frontend `3000`; বাইরের সব backend route `/api` দিয়ে শুরু। নতুন uvicorn/Node HTTP server খুলবেন না। সাধারণ source পরিবর্তনে hot reload; package/env বদলালে restart।

### 4. Health ও tests

```bash
API_URL=$(grep REACT_APP_BACKEND_URL frontend/.env | cut -d '=' -f2)
curl -fsS "$API_URL/api/health"
curl -fsS "$API_URL/api/v1/runtime"
pytest backend/tests/ -v
python backend/import_legacy.py  # optional, idempotent archival import
```

পরীক্ষা: **27/27 backend tests passed**। Frontend desktop workflow এবং mobile navigation/overflow যাচাই করা হয়েছে। Details: `test_reports/iteration_1.json`, `test_reports/final_verification.json`; reusable demo tests: `backend/tests/test_demo_ledger_api.py`।

## Observer setup

1. Settings → Observer extension থেকে ZIP download, extract।
2. Chrome Extensions → Developer mode → Load unpacked।
3. Options-এ `REACT_APP_BACKEND_URL`-এর origin এবং backend `.env`-এর `OBSERVER_SERVICE_KEY` দিন। Key frontend/repository/URL/screenshot-এ দেবেন না।
4. Save ও Test connection; অনুমোদিত provider tab খুলে প্রকৃত visible DOM selectors মিলিয়ে নিন।
5. দৃশ্যমান data না থাকলে `DOM_UNAVAILABLE`; canvas-only prices বানানো বা private cookies/WebSocket/token সংগ্রহ করা হয় না।

## প্রধান API

- `GET /api/health`
- `GET /api/v1/runtime`, `/modules`, `/instruments`, `/top-pairs`, `/history`, `/events`
- `GET /api/v1/market/state?source=deriv&symbol=EUR%2FUSD&timeframe=1m`
- `POST /api/v1/analysis` → `{source,symbol,timeframe}`
- `GET /api/v1/analysis/latest`, `/observation`, `/observer/download`
- `GET /api/v1/observation/check`; `POST /pairs`, `/tick`, `/event` under `/observation` — `X-Market-QX-Key` required
- `POST /api/v1/demo/session` — private secure HttpOnly cookie
- `GET /api/v1/demo/account`, `/api/v1/demo/history` — same demo cookie
- `POST /api/v1/demo/actions` — `{requestId: UUID, kind: place|deposit|withdraw|reset, ...}`

Demo history includes reset archives. Quote/payout input is server catalog-owned; browser cannot choose execution prices. Demo settlement is reconciled atomically on account reads/actions, including after reopening the browser. Analytical and demo records never train a model automatically.

## পরবর্তী কাজ

**P0 (external prerequisites):** আসল authorized QX tab-এর selectors যাচাই; অনুপস্থিত specialized-agent source সংগ্রহ অথবা আলাদা অনুমোদিত, versioned replacement specification।

**P1:** provenance-tracked outcomes, training, temporal validation/calibration ও risk gates; যোগ্য signal selection; broader dynamic market catalog; বড় demo ledger-র archival pagination এবং account recovery।

**P2:** favourites/watchlist persistence, replay, offline alerts।

পুরোনো upstream documentation: `memory/upstream_README.md`, `memory/upstream_checkpoint.md`। Current status-এর জন্য এই README/PRD-ই ব্যবহার করুন।