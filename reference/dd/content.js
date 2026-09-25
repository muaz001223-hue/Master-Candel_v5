/* global chrome, document, location, MutationObserver, getComputedStyle */

(() => {
  "use strict";

  const SOURCE = "MARKET_QX_BROWSER_OBSERVATION";
  const DEFAULT_CONFIG = {
    pairSelectors: [
      "[data-symbol]",
      "[data-pair]",
      "[data-instrument]",
      "[data-market-pair]",
      "[data-testid*='pair']",
      "[data-testid*='symbol']",
      "[data-testid*='instrument']",
      "[id*='pair']",
      "[id*='symbol']",
      "[id*='instrument']",
      "[class*='pair']",
      "[class*='symbol']",
      "[class*='instrument']",
      "[aria-label*='pair']",
      "[aria-label*='symbol']",
      "[aria-label*='instrument']",
      "[title*='pair']",
      "[title*='symbol']",
      "[title*='instrument']",
      "[aria-selected=\"true\"][aria-label]",
      "div",
      "span",
      "strong",
      "button",
      "p"
    ],
    priceSelectors: [
      "[data-price]",
      "[data-last-price]",
      "[data-quote]",
      "[data-current-price]",
      "[data-value]",
      "[class*='price']",
      "[class*='quote']",
      "[class*='last']",
      "[class*='current']",
      "[id*='price']",
      "[id*='quote']",
      "[id*='last']",
      "[id*='current']",
      "[data-testid*='price']",
      "[data-testid*='quote']",
      "[data-testid*='last']",
      "div",
      "span",
      "strong",
      "button",
      "p"
    ],
    candleSelectors: {
      open: ["[data-open]", "[data-candle-open]", "[class*='open']", "[id*='open']"],
      high: ["[data-high]", "[data-candle-high]", "[class*='high']", "[id*='high']"],
      low: ["[data-low]", "[data-candle-low]", "[class*='low']", "[id*='low']"],
      close: ["[data-close]", "[data-candle-close]", "[class*='close']", "[id*='close']"]
    },
    timeframeSelectors: [
      "[data-timeframe]",
      "[data-interval]",
      "[data-period]",
      "[class*='timeframe']",
      "[class*='interval']",
      "[id*='timeframe']",
      "[id*='interval']",
      "[data-testid*='timeframe']"
    ],
    volumeSelectors: ["[data-volume]", "[data-candle-volume]", "[class*='volume']", "[id*='volume']"]
  };

  let config = DEFAULT_CONFIG;
  let lastPair = null;
  let lastCandleKey = null;
  let timer = null;
  let observer = null;

  const text = (element, attributes = []) => {
    if (!element) return "";
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (value?.trim()) return value.trim();
    }
    return (element.getAttribute("data-value") || element.getAttribute("value") || element.getAttribute("aria-label") || element.textContent || "").trim();
  };

  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && box.width > 0 && box.height > 0;
  };

  const firstVisible = (selectors) => {
    for (const selector of selectors || []) {
      const match = [...document.querySelectorAll(selector)].find(visible);
      if (match) return match;
    }
    return null;
  };

  const parseNumber = (value) => {
    if (typeof value !== "string") return null;
    const localizedDigits = value.replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
    const withoutCurrency = localizedDigits
      .replace(/[\u0660-\u0669]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[৳$€£₹¥₽]/g, "")
      .replace(/[٫]/g, ".")
      .replace(/[٬]/g, ",")
      .replace(/[\s_]/g, "");
    const normalized = (withoutCurrency.includes(".") ? withoutCurrency.replace(/,/g, "") : withoutCurrency.replace(/,/g, "."))
      .match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!normalized) return null;
    const number = Number(normalized[0]);
    return Number.isFinite(number) ? number : null;
  };

  const scanVisibleTextMatches = (predicate) => {
    const all = [...document.body.querySelectorAll("div,span,strong,p,button,li,td,th,a,b")];
    const matches = all.filter((element) => visible(element) && predicate(element));
    return matches.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length);
  };

  const findVisiblePairCandidate = () => {
    const candidates = scanVisibleTextMatches((element) => {
      const raw = (element.textContent || "").trim();
      if (!raw) return false;
      const candidate = raw.replace(/\s+/g, " ").trim();
      return /(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|XAU|XAG|R_\d+|OTC|\/)i.test(candidate) && /[A-Z]/i.test(candidate);
    });
    return candidates[0] || null;
  };

  const findVisibleNumericCandidate = (selectors, attributes = []) => {
    const candidates = scanVisibleTextMatches((element) => {
      const raw = text(element, attributes) || (element.textContent || "").trim();
      return raw && /-?\d+(?:[.,]\d+)?/.test(raw);
    });

    if (!candidates.length) return null;
    const best = candidates.find((element) => parseNumber((text(element, attributes) || element.textContent || "").trim()) !== null);
    if (!best) return null;
    return parseNumber((text(best, attributes) || best.textContent || "").trim());
  };

  const readNumber = (selectors, attributes = []) => {
    const element = firstVisible(selectors);
    const direct = element ? parseNumber(text(element, attributes) || (element.textContent || "").trim()) : null;
    if (direct !== null) return direct;
    return findVisibleNumericCandidate(selectors, attributes);
  };

  const readPair = () => {
    const element = firstVisible(config.pairSelectors) || findVisiblePairCandidate();
    const raw = text(element, ["data-symbol", "data-pair", "data-instrument", "data-market-pair", "data-value", "aria-label"]) || (element?.textContent || "").trim();
    if (!raw) return null;

    const match = raw.match(/(?:[A-Z]{3,6}|R_\d+)(?:\s*\/\s*[A-Z]{3,6}|\s*[A-Z]{3,6})?/i);
    if (match) {
      const normalized = match[0].replace(/\s+/g, "").toUpperCase();
      return normalized.length ? normalized : null;
    }

    const alt = raw.match(/(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|NZD|XAU|XAG|R_\d+)/i);
    return alt ? alt[0].toUpperCase() : null;
  };

  const readTimeframe = () => {
    const element = firstVisible(config.timeframeSelectors);
    const raw = text(element, ["data-timeframe", "data-interval", "data-period", "data-value"]) || (element?.textContent || "").trim();
    if (raw) {
      const match = raw.match(/(\d+\s*(?:m|s|min|mins|sec|secs|h|d)|[Mm]1|[Mm]5|[Hh]1)/i);
      if (match) return match[1].toLowerCase().replace(/\s+/g, "");
    }
    const all = scanVisibleTextMatches((node) => /(\d+\s*(?:m|s|min|mins|sec|secs|h|d)|[Mm]1|[Mm]5|[Hh]1)/i.test((node.textContent || "").trim()));
    if (!all.length) return null;
    const match = (all[0].textContent || "").match(/(\d+\s*(?:m|s|min|mins|sec|secs|h|d)|[Mm]1|[Mm]5|[Hh]1)/i);
    return match ? match[1].toLowerCase().replace(/\s+/g, "") : null;
  };

  const postMessage = (message) => chrome.runtime.sendMessage({ ...message, source: SOURCE });

  function selectorDiagnostics() {
    const groups = {
      pair: config.pairSelectors,
      price: config.priceSelectors,
      open: config.candleSelectors.open,
      high: config.candleSelectors.high,
      low: config.candleSelectors.low,
      close: config.candleSelectors.close,
      timeframe: config.timeframeSelectors,
      volume: config.volumeSelectors
    };

    const matches = Object.fromEntries(Object.entries(groups).map(([name, selectors]) => [
      name,
      (selectors || []).map((selector) => ({ selector, visibleMatches: [...document.querySelectorAll(selector)].filter(visible).length }))
    ]));

    const canvasCount = [...document.querySelectorAll("canvas")].filter(visible).length;
    const pairMatches = matches.pair.some((item) => item.visibleMatches > 0);
    const priceMatches = matches.price.some((item) => item.visibleMatches > 0);
    const candleMatches = [
      matches.open.some((item) => item.visibleMatches > 0),
      matches.high.some((item) => item.visibleMatches > 0),
      matches.low.some((item) => item.visibleMatches > 0),
      matches.close.some((item) => item.visibleMatches > 0)
    ].some(Boolean);

    const marketDomDataAvailable = pairMatches || priceMatches || candleMatches;

    postMessage({
      type: "SELECTOR_DIAGNOSTICS",
      url: location.href,
      title: document.title,
      matches,
      canvasCount,
      marketDomDataAvailable,
      observedAt: new Date().toISOString()
    });

    if (!marketDomDataAvailable) {
      postMessage({
        type: "DOM_MARKET_DATA_UNAVAILABLE",
        reason: "VISIBLE_PAIR_OR_PRICE_NOT_FOUND",
        canvasCount,
        observedAt: new Date().toISOString()
      });
    }
  }

  function observeVisibleMarket() {
    const pair = readPair();
    if (!pair) return;

    if (pair !== lastPair) {
      lastPair = pair;
      postMessage({ type: "PAIR_DETECTED", pair, observedAt: new Date().toISOString() });
    }

    const open = readNumber(config.candleSelectors.open, ["data-open", "data-candle-open"]);
    const high = readNumber(config.candleSelectors.high, ["data-high", "data-candle-high"]);
    const low = readNumber(config.candleSelectors.low, ["data-low", "data-candle-low"]);
    const close = readNumber(config.candleSelectors.close, ["data-close", "data-candle-close"]);
    const price = readNumber(config.priceSelectors, ["data-price", "data-last-price", "data-quote", "data-current-price"]);
    const timeframe = readTimeframe();
    const volume = readNumber(config.volumeSelectors);
    const observedAt = new Date().toISOString();

    if (price !== null) {
      postMessage({ type: "PRICE_OBSERVED", pair, price, timeframe, observedAt });
    }

    if ([open, high, low, close].some((value) => value === null) || !timeframe) {
      return;
    }

    if (high < Math.max(open, close) || low > Math.min(open, close)) return;

    const candleKey = JSON.stringify({ pair, timeframe, open, high, low, close, volume });
    if (candleKey === lastCandleKey) return;
    lastCandleKey = candleKey;

    postMessage({
      type: "CANDLE_OBSERVED",
      pair,
      timeframe,
      price: price ?? close,
      timestamp: observedAt,
      candle: { open, high, low, close, volume: volume ?? 0 }
    });
  }

  function start() {
    if (observer) observer.disconnect();
    if (timer) clearInterval(timer);

    observeVisibleMarket();
    observer = new MutationObserver(observeVisibleMarket);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-symbol", "data-pair", "data-price", "data-open", "data-high", "data-low", "data-close"]
    });

    timer = setInterval(observeVisibleMarket, 1000);
    postMessage({ type: "BRIDGE_READY", url: location.href, observedAt: new Date().toISOString() });
    selectorDiagnostics();
    observeVisibleMarket();
  }

  chrome.storage.local.get({ marketQxObserverConfig: DEFAULT_CONFIG }, (stored) => {
    config = { ...DEFAULT_CONFIG, ...(stored.marketQxObserverConfig || {}) };
    start();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RELOAD_CONFIG") {
      chrome.storage.local.get({ marketQxObserverConfig: DEFAULT_CONFIG }, (stored) => {
        config = { ...DEFAULT_CONFIG, ...(stored.marketQxObserverConfig || {}) };
        start();
      });
      return;
    }

    if (message?.type === "RESYNC_OBSERVATION" || message?.type === "PING_OBSERVATION") {
      postMessage({ type: "BRIDGE_READY", url: location.href, observedAt: new Date().toISOString(), resync: true });
      selectorDiagnostics();
      observeVisibleMarket();
    }
  });
})();
