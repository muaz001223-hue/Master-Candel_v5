/* global chrome, fetch */

const BACKEND = "http://localhost:4000";
const SOURCE = "MARKET_QX_BROWSER_OBSERVATION";
const queue = [];
let flushing = false;

function log(message, detail) {
  console.info(`[BROWSER-DATA-BRIDGE] ${message}`, detail || "");
  void chrome.storage.local.set({
    marketQxObserverLastLog: { message, detail: detail || null, loggedAt: new Date().toISOString() }
  });
}

function enqueue(path, body) {
  queue.push({ path, body, attempts: 0 });
  void flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;

  try {
    while (queue.length) {
      const item = queue[0];
      try {
        item.attempts += 1;
        const response = await fetch(`${BACKEND}${item.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.body)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        queue.shift();
        log("event_forwarded", { path: item.path, source: SOURCE });
      } catch (error) {
        log("transport_retry", { path: item.path, attempts: item.attempts, error: String(error) });
        if (item.attempts >= 3) {
          queue.shift();
          log("event_dropped_after_retries", { path: item.path });
        } else {
          await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * (2 ** item.attempts))));
        }
      }
    }
  } finally {
    flushing = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.source !== SOURCE) return;

  const tabUrl = sender.tab?.url || "";
  if (!/^https:\/\/(market-qx\.info|[^/]+\.quotex\.com)\//i.test(tabUrl)) {
    log("rejected_untrusted_tab", { tabUrl });
    return;
  }

  if (message.type === "BRIDGE_READY") {
    log("bridge_ready", { url: message.url, tabId: sender.tab?.id, source: SOURCE });
    return;
  }

  if (message.type === "SELECTOR_DIAGNOSTICS") {
    log("selector_diagnostics", {
      url: message.url,
      title: message.title,
      matches: message.matches,
      canvasCount: message.canvasCount,
      marketDomDataAvailable: message.marketDomDataAvailable,
      source: SOURCE
    });
    return;
  }

  if (message.type === "DOM_MARKET_DATA_UNAVAILABLE") {
    log("dom_market_data_unavailable", { reason: message.reason, canvasCount: message.canvasCount, source: SOURCE });
    return;
  }

  if (message.type === "PAIR_DETECTED" && typeof message.pair === "string" && message.pair.trim()) {
    const pair = message.pair.trim();
    log("pair_detected", { pair, source: SOURCE });
    enqueue("/api/v1/observation/pairs", {
      instruments: [pair],
      pairs: [{ symbol: pair, providerSymbol: pair, timeframe: "1m" }],
      source: SOURCE,
      observedAt: message.observedAt
    });
    return;
  }

  if (message.type === "PRICE_OBSERVED") {
    if (typeof message.pair !== "string" || typeof message.price !== "number" || !Number.isFinite(message.price)) return;
    enqueue("/api/v1/observation/tick", {
      symbol: message.pair,
      providerSymbol: message.pair,
      price: message.price,
      timeframe: typeof message.timeframe === "string" ? message.timeframe : "tick",
      timestamp: message.observedAt,
      source: SOURCE,
      observationMethod: "visible-dom-only"
    });
    return;
  }

  if (message.type === "CANDLE_OBSERVED" && message.candle && typeof message.pair === "string" && typeof message.timeframe === "string") {
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) {
      log("rejected_invalid_timestamp", { pair: message.pair, timestamp: message.timestamp });
      return;
    }

    const closeTimestamp = new Date(timestamp).toISOString();
    const openTimestamp = new Date(timestamp - 60_000).toISOString();
    const candle = message.candle;

    if (![candle.open, candle.high, candle.low, candle.close].every((value) => typeof value === "number" && Number.isFinite(value))) {
      log("rejected_incomplete_candle", { pair: message.pair });
      return;
    }

    enqueue("/api/v1/observation/event", {
      symbol: message.pair,
      providerSymbol: message.pair,
      timeframe: message.timeframe,
      timestamp: openTimestamp,
      closeTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: typeof candle.volume === "number" ? candle.volume : null,
      source: SOURCE,
      observationMethod: "visible-dom-only"
    });
  }
});
