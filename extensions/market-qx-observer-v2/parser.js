/* global document, getComputedStyle */
globalThis.MarketQxParser = (() => {
  const defaults = {
    pairSelectors: ['[data-symbol]', '[data-pair]', '[data-instrument]', '[data-market-pair]'],
    priceSelectors: ['[data-price]', '[data-last-price]', '[data-quote]', '[data-current-price]'],
    timeframeSelectors: ['[data-timeframe]', '[data-interval]'],
    candleSelectors: { open: ['[data-open]'], high: ['[data-high]'], low: ['[data-low]'], close: ['[data-close]'] },
    timestampSelectors: ['[data-candle-epoch]', '[data-candle-timestamp]'],
    closedSelectors: ['[data-candle-closed="true"]']
  };
  function visible(el) {
    const style = getComputedStyle(el), box = el.getBoundingClientRect();
    return el.isConnected && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
  }
  function read(selectors, attributes) {
    for (const selector of selectors || []) {
      let nodes;
      try { nodes = document.querySelectorAll(selector); } catch { continue; }
      for (const el of nodes) {
        if (!visible(el)) continue;
        const raw = attributes.map(a => el.getAttribute(a)).find(v => v?.trim()) ?? el.textContent;
        if (raw?.trim()) return raw.trim();
      }
    }
    return null;
  }
  function number(raw) {
    if (!raw) return null;
    const value = raw.replace(/[০-৯]/g, n => String('০১২৩৪৫৬৭৮৯'.indexOf(n))).replace(/[٠-٩]/g, n => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n))).replace(/[৳$€£₹¥]/g, '').trim();
    const normal = value.includes('.') ? value.replace(/,/g, '') : value.replace(',', '.');
    return /^\d+(?:\.\d+)?$/.test(normal) && Number(normal) > 0 ? Number(normal) : null;
  }
  function timeframe(raw) {
    if (!raw) return null;
    const normal = raw.toLowerCase().replace(/\s/g, '').replace(/^m(\d+)$/, '$1m').replace(/mins?$/, 'm').replace(/secs?$/, 's');
    return { '1s': 1, '5s': 5, '15s': 15, '1m': 60, '5m': 300 }[normal] ? normal : null;
  }
  function snapshot(custom = {}) {
    const c = { ...defaults, ...custom, candleSelectors: { ...defaults.candleSelectors, ...custom.candleSelectors } };
    const pair = read(c.pairSelectors, ['data-symbol', 'data-pair', 'data-instrument', 'data-market-pair']);
    if (!pair || pair.length > 64 || !/^[A-Za-z0-9 /_.()&+-]+$/.test(pair)) return { reason: 'PAIR_NOT_VISIBLE' };
    const price = number(read(c.priceSelectors, ['data-price', 'data-last-price', 'data-quote', 'data-current-price']));
    const tf = timeframe(read(c.timeframeSelectors, ['data-timeframe', 'data-interval']));
    const candle = Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, number(read(c.candleSelectors[k], [`data-${k}`, `data-candle-${k}`]))]));
    const rawTime = read(c.timestampSelectors, ['data-candle-epoch', 'data-candle-timestamp']);
    const start = rawTime && /^\d+$/.test(rawTime) ? Number(rawTime) * (Number(rawTime) > 1e11 ? 1 : 1000) : rawTime ? Date.parse(rawTime) : NaN;
    const seconds = { '1s': 1, '5s': 5, '15s': 15, '1m': 60, '5m': 300 }[tf];
    const end = start + seconds * 1000;
    const closed = read(c.closedSelectors, ['data-candle-closed']) === 'true';
    const validCandle = closed && Object.values(candle).every(v => v !== null) && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) && Number.isFinite(start) && start % (seconds * 1000) === 0 && end <= Date.now() && Date.now() - end <= 120000;
    return { pair, price, timeframe: tf, candle: validCandle ? candle : null, timestamp: validCandle ? new Date(start).toISOString() : null, closeTimestamp: validCandle ? new Date(end).toISOString() : null, reason: price === null && !validCandle ? 'VISIBLE_MARKET_DATA_UNAVAILABLE' : null };
  }
  return { snapshot, number, timeframe, defaults };
})();