# Market-QX Visible Market Observer v2

Based on developers0112-hue/dd commit 7568d8a. Transport and parsing adapted for
Master Candle's /api/v1/observation/{pairs,tick,event} contract.

1. Load this directory unpacked in Chrome Developer mode.
2. Click the extension icon to open options.
3. Set backend origin from frontend REACT_APP_BACKEND_URL and the service key
   from backend OBSERVER_SERVICE_KEY. Save and grant only that backend origin.
4. Test connection. Open/reload the supported provider page.
5. If status is DOM_UNAVAILABLE, configure exact selectors for the real visible
   pair/price fields; do not select account balances, countdowns or container text.

Default selectors use explicit data-symbol/data-pair/data-price etc. Actual
broker DOM compatibility requires verification on the user's authorized tab.
Canvas-only prices cannot be read by this DOM-only observer. No cookie/session
token extraction, network interception, private API, or real trade execution.

Optional candle observations require visible epoch/open timestamp, timeframe,
OHLC, and data-candle-closed="true". Missing timestamps are never invented.
OTC identifiers are preserved. Ticks use receipt time and the backend marks
tick-derived candles as partial coverage.

The transport queue is capped at 500, persisted across MV3 suspension, retries
transient errors with alarms, expires old events, and reports authentication /
validation / transport issues in options. No service key is embedded in this ZIP.