/* global chrome */
const SOURCE = 'MARKET_QX_BROWSER_OBSERVATION';
let queue = [], flushing = false;
const loaded = chrome.storage.local.get('observerQueue').then(s => { queue = s.observerQueue || []; });
const save = () => chrome.storage.local.set({ observerQueue: queue });
const status = (state, reason = null) => chrome.storage.local.set({ observerStatus: { state, reason, pending: queue.length, at: new Date().toISOString() } });

async function flush() {
  await loaded;
  if (flushing) return;
  flushing = true;
  try {
    const { backendUrl, serviceKey } = await chrome.storage.local.get(['backendUrl', 'serviceKey']);
    if (!backendUrl || !serviceKey) { await status('NOT_CONFIGURED'); return; }
    while (queue.length) {
      const item = queue[0];
      if (Date.now() - item.created > 120000) { queue.shift(); await save(); await status('STALE_EVENT_DROPPED'); continue; }
      try {
        const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/v1/observation/${item.kind}`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Market-QX-Key': serviceKey }, body: JSON.stringify(item.body), signal: AbortSignal.timeout(10000) });
        if (response.status === 401 || response.status === 403) { await status('AUTHENTICATION_REQUIRED'); break; }
        if (!response.ok && (response.status >= 500 || response.status === 429)) throw new Error(`HTTP_${response.status}`);
        queue.shift(); await save();
        await status(response.ok ? 'CONNECTED' : 'EVENT_REJECTED', response.ok ? null : `HTTP_${response.status}`);
      } catch {
        item.attempts += 1;
        if (item.attempts >= 5) { queue.shift(); await save(); await status('RETRY_LIMIT_REACHED'); }
        else { await save(); await status('RECONNECTING'); }
        chrome.alarms.create('observer-retry', { delayInMinutes: .5 });
        break;
      }
    }
  } finally { flushing = false; }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.source !== SOURCE) return;
  let host;
  try { host = new URL(sender.tab?.url).hostname; } catch { return; }
  if (!(host === 'market-qx.info' || host.endsWith('.quotex.com') || host === 'quotex.com')) return;
  (async () => {
    await loaded;
    if (message.type === 'DOM_MARKET_DATA_UNAVAILABLE') { await status('DOM_UNAVAILABLE', message.reason); reply({ ok: true }); return; }
    const base = { source: SOURCE, schema_version: 2, session_id: message.session_id, dedupe_id: message.dedupe_id, observationMethod: 'visible-dom-only' };
    let kind, body;
    if (message.type === 'PAIR_DETECTED') { kind = 'pairs'; body = { ...base, pairs: [{ symbol: message.pair, providerSymbol: message.pair, timeframe: '1m' }] }; }
    if (message.type === 'PRICE_OBSERVED') { kind = 'tick'; body = { ...base, symbol: message.pair, providerSymbol: message.pair, price: message.price, timeframe: message.timeframe || 'tick', timestamp: message.observedAt }; }
    if (message.type === 'CANDLE_OBSERVED') { kind = 'event'; body = { ...base, symbol: message.pair, providerSymbol: message.pair, timeframe: message.timeframe, timestamp: message.timestamp, closeTimestamp: message.closeTimestamp, ...message.candle }; }
    if (!kind || !base.session_id || !base.dedupe_id) { reply({ ok: false }); return; }
    if (queue.length >= 500) { await status('QUEUE_FULL'); reply({ ok: false }); return; }
    queue.push({ kind, body, attempts: 0, created: Date.now() }); await save();
    reply({ ok: true }); void flush();
  })().catch(() => reply({ ok: false }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'observer-retry') void flush(); });
chrome.storage.onChanged.addListener(changes => { if (changes.backendUrl || changes.serviceKey) void flush(); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
void flush();