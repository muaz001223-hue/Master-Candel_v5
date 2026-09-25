# Master Candle — Active PRD / Handoff

## Original request (raw)
git clone https://github.com/methomia913-glitch/Master-Candel-Main.git .
https://github.com/methomia913-glitch/Master-Candel-Main.git

"Ami amar full-stack project clone/setup korte chai. Project structure o environment configuration neche dewa holo:

Repository Structure:

Root directory-te shob backend configuration ache (package.json, Dockerfile, index.js, etc.).

Backend code run korar jonno dependency install koro and server start koro.

Environment Variables (.env):

.env.example file dekhe sob required variables set koro.

Database & Services:

Database connection (MongoDB / PostgreSQL) and router files check koro jate shob routes perfectly connect hoy.

Purata check kore step-by-step backend server o database connection run kore dao.

r ja ja kaj baki aca sagula kora dan txt,readmi ta thakar kotha baki kaj gula othoba github a laka thakar kotha khub valomoto sobkisu chack kora build koran"

User: "Start the task now". Clarified approval: "হ্যাঁ—বর্তমান ডিজাইন ও ফিচার রেখে সেটআপ, ডেটাবেস সংযোগ এবং অসম্পূর্ণ কাজ সম্পন্ন করুন। প্রয়োজনীয় গোপন কী না থাকলে জানাবেন।" Additional: "100% same vaba banan".

## Static requirements / personas
- Bengali-speaking nontechnical project owner needs a runnable exact-design continuation, not a redesign or landing page.
- Market analyst uses real source-isolated data, quality/indicators, history and runtime diagnostics.
- Practice user uses clearly simulated virtual trading, never real-money execution.
- Preserve original appearance, do not count configured slots as implemented agents, never manufacture broker data or prediction performance.
- Inspect actual repository rather than assuming root Node/PostgreSQL architecture.

## Architecture decisions
- Repository commit imported: `8c1252ff25f8d92bad4839362f635240e950ecbd` from user repository. Old upstream checkpoint archived in `memory/upstream_checkpoint.md`; it is NOT current status.
- Frontend: original React19/TypeScript/Vite8/Tailwind4/base-ui; original CSS retained, only mobile navigation fix appended. No CRA migration.
- Backend: original FastAPI/Motor Mongo store; Node stdio analytical worker uses reusable vendor engines. No new HTTP worker or PostgreSQL/Redis.
- Backend supervisor8001; frontend3000. All network access through environment config, frontend API through protected REACT_APP_BACKEND_URL.
- Protected existing MONGO_URL/DB_NAME retained. Stale source frontend URL corrected to original current environment URL. Public origin aligned; backend CORS wildcard resolves to configured app origin.
- Source identities deriv vs market-qx-observer-v2 remain separate. OTC cannot inherit Deriv prices.
- Demo ledger uses Secure HttpOnly SameSite=Lax private browser cookie; hash stored as account identity, optimistic versioned Mongo updates. Read/action-driven deterministic settlement; complete current+reset archive persistence. No real order execution. Generated catalog mirrors frontend SIMULATED catalog, not source market evidence.
- Secret files ignored; source's publicly exposed unused provider tokens must be rotated externally. Observer key freshly regenerated, not copied into frontend/ZIP.

## Implemented — 2026-09-24
1. Cloned repository and inspected README, PROJECT_STATUS, source and upstream test findings.
2. Installed original frontend dependencies. Removed incompatible leftover starter App.js/UI JSX/PostCSS/Tailwind3 files that interfered with original Vite app. Original UI restored and production build passes.
3. Fixed pip requirements URL pin conflict by excluding unused emergentintegrations/litellm from pip freeze. Requirements dry-run passes.
4. Mongo and real Deriv stream/history/analysis running; live observation verified32accepted streams at check time. Original missing-agent and calibration NO_SIGNAL gates preserved.
5. Added env examples and idempotent runtime setup/observer-key rotation; generated current-origin extension permissions.
6. Added server-saved demo account, strict funds/trade validations, max20active orders, idempotent requestId, concurrent-update protection, pending minute/expiry settlement, reset archival history, browser-session isolation. Preserved Trade UI and quote formula. Funds modal stays open on invalid input.
7. Added functional `/signals`, `/analytics`, `/flow`, `/logs`, `/settings` pages with API data, refresh, CSV and observer ZIP. Original Home sidebar now navigates instead of only toasts. API roundtrip diagnostics measured, not invented latency.
8. Fixed mobile Home navigation: existing menu button now opens accessible modal linking all workspace routes; no desktop redesign.
9. Imported296legacy candles+2legacy signals into unverified archival Mongo collections only, idempotent.
10. Updated README/PROJECT_STATUS/this PRD for truthful handoff.
11. Resolved final-check lint engine failure: added ESLint with Babel TypeScript parser (without changing TypeScript7), removed unused CRA config/hooks. ESLint passes; original Oxlint passes with3existing UI fast-refresh warnings; final production build passes.

## Verification
- Testing agent:27/27 backend tests pass. Added `/app/backend/tests/test_demo_ledger_api.py` covers session cookie, auth/session isolation, amounts, min stake, unknown markets,5s expiry, pending,20order cap, request replay, concurrent withdrawals, reset+archive.
- Existing market/observer validation regression passes; live Deriv API verified through external URL.
- Agent desktop Home/Trade/Workspace and mobile no-overflow checks pass; identified mobile Home links inaccessible (hidden original sidebar+menu).
- Main-agent fix verified with screenshot tool: all five mobile menu routes work at390px; document overflow checks pass320/390/768px. Desktop original terminal screenshot retained.
- Reports: `test_reports/iteration_1.json` retains pre-fix finding; `test_reports/final_verification.json` records subsequent fix verification. Screenshots `final-terminal.jpeg`, `mobile-navigation-fixed.jpeg` (if screenshot runner path external, use automation output).
- No real authorized QX browser available. Do not assert live DOM compatibility.

## Prioritized backlog
### P0 — blocked external prerequisites
- Actual authorized market-qx/Quotex tab, live visible selectors, observed-data receipt verification.
- Missing original agents/{registry,orchestrator,specialized,catalog}.js. No500workers implemented. Obtain source or explicitly scope/version replacements; never present arbitrary replacements as original clone.
- Rotate any other valid tokens previously published in upstream repo; those are not needed for public Deriv.

### P1 — substantive research/features not completed
- Provenance-tracked outcome dataset; self-training, OOS/walk-forward, calibration and risk gates; qualified predictive signals only after evidence.
- Hidden-algorithm detection not implemented; no unsupported claim that it can recover broker internals.
- Dynamic broader instrument subscription/catalog and quality eligibility.
- Scale demo ledger into paginated separate trade/archive collections before large histories; anonymous-cookie recovery/cross-device account would require a separately scoped identity flow.
- Expose archived demo records in a dedicated UI (currently complete `/api/v1/demo/history` endpoint).

### P2
- Persist favourites/watchlists, historical replay, offline alerts.

## Next tasks
Connect authorized observer tab, collect missing agent source, then scope dataset/research validation. All11subsystems are NOT complete; app setup and described feasible continuation work are complete and verified.
## Clone checkpoint (this environment)
- Source: https://github.com/methomia72-create/Master-Candel-Final_ copied 1:1 into /app (verified with `diff -rq`).
- Only deviations (user-approved): removed `@emergentbase/*` dev plugins from `frontend/vite.config.ts` + `package.json`, deleted stale `frontend/public/index.html`; added optional `backend/postgres_service.py` (asyncpg, Neon `DATABASE_URL`) reported in `/api/health`.
- `.env`: protected MONGO_URL / REACT_APP_BACKEND_URL kept; user's full variable set appended; `DEV_PORT=3000`; runtime keys generated via `scripts/setup_runtime.py`; extension manifest regenerated via `backend/configure_extension.py`; legacy SQLite imported via `backend/import_legacy.py`.
- Verified: pytest 27/27, backend testing agent 21/22 (the one "fail" was an invalid test pairId, expected 422), Deriv 32/32 symbols DATA_RECEIVING, PostgreSQL CONNECTED, observer key auth OK.
