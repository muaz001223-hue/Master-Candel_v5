/* global chrome, MutationObserver, MarketQxParser */
(() => {
  const SOURCE = 'MARKET_QX_BROWSER_OBSERVATION';
  const session_id = crypto.randomUUID();
  let sequence = 0, lastPair = '', lastPrice = '', lastCandle = '', lastReason = '', config = {}, timer;
  const send = data => chrome.runtime.sendMessage({ ...data, source: SOURCE, schema_version: 2, session_id, dedupe_id: `${session_id}:${++sequence}`, observationMethod: 'visible-dom-only' }).catch(() => {});
  function scan() {
    const row = MarketQxParser.snapshot(config);
    if (row.reason && row.reason !== lastReason) {
      lastReason = row.reason;
      send({ type: 'DOM_MARKET_DATA_UNAVAILABLE', reason: row.reason });
    }
    if (!row.pair) return;
    const observedAt = new Date().toISOString();
    if (row.pair !== lastPair) { lastPair = row.pair; send({ type: 'PAIR_DETECTED', pair: row.pair, observedAt }); }
    const priceKey = `${row.pair}:${row.price}`;
    if (row.price !== null && priceKey !== lastPrice) {
      lastPrice = priceKey;
      send({ type: 'PRICE_OBSERVED', pair: row.pair, price: row.price, timeframe: row.timeframe || 'tick', observedAt });
    }
    const candleKey = JSON.stringify([row.pair, row.timeframe, row.timestamp, row.candle]);
    if (row.candle && candleKey !== lastCandle) {
      lastCandle = candleKey;
      send({ type: 'CANDLE_OBSERVED', pair: row.pair, timeframe: row.timeframe, candle: row.candle, timestamp: row.timestamp, closeTimestamp: row.closeTimestamp });
    }
  }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 500); }
  chrome.storage.local.get('marketQxObserverConfig').then(stored => {
    config = stored.marketQxObserverConfig || {};
    scan();
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-symbol', 'data-pair', 'data-price', 'data-last-price', 'data-open', 'data-high', 'data-low', 'data-close', 'data-candle-epoch', 'data-candle-closed'] });
    setInterval(schedule, 1000);
  });
  chrome.runtime.onMessage.addListener(message => {
    if (['RELOAD_CONFIG', 'RESYNC_OBSERVATION', 'PING_OBSERVATION'].includes(message?.type)) {
      chrome.storage.local.get('marketQxObserverConfig').then(stored => { config = stored.marketQxObserverConfig || {}; lastPrice = ''; scan(); });
    }
  });
})();