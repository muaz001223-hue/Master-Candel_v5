/* global chrome */
const $ = id => document.getElementById(id);
chrome.storage.local.get(['backendUrl', 'serviceKey', 'marketQxObserverConfig', 'observerStatus']).then(c => {
  $('backend').value = c.backendUrl || '';
  $('key').value = c.serviceKey || '';
  $('selectors').value = JSON.stringify(c.marketQxObserverConfig || {}, null, 2);
  $('status').textContent = JSON.stringify(c.observerStatus || { state: 'NOT_CONFIGURED' });
});
$('save').onclick = async () => {
  try {
    const url = new URL($('backend').value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('HTTPS required');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter the backend origin only');
    const selectors = JSON.parse($('selectors').value || '{}');
    if (!selectors || Array.isArray(selectors) || typeof selectors !== 'object') throw new Error('Selectors must be a JSON object');
    for (const list of Object.values(selectors)) {
      const groups = Array.isArray(list) ? [list] : list && typeof list === 'object' ? Object.values(list) : [];
      if (!groups.length) throw new Error('Selector groups must be arrays');
      for (const group of groups) {
        if (!Array.isArray(group) || group.some(x => typeof x !== 'string')) throw new Error('Selectors must be strings');
        for (const selector of group) document.querySelector(selector);
      }
    }
    if (!$('key').value.trim()) throw new Error('Service key required');
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error('Backend permission was not granted');
    await chrome.storage.local.set({ backendUrl: url.origin, serviceKey: $('key').value.trim(), marketQxObserverConfig: selectors });
    $('result').textContent = 'Saved. Reload the provider tab to apply selector changes.';
  } catch (error) { $('result').textContent = error.message; }
};
$('test').onclick = async () => {
  try {
    const c = await chrome.storage.local.get(['backendUrl', 'serviceKey']);
    if (!c.backendUrl || !c.serviceKey) throw new Error('Save connection settings first');
    const r = await fetch(`${c.backendUrl}/api/v1/observation/check`, { credentials: 'omit', headers: { 'X-Market-QX-Key': c.serviceKey }, signal: AbortSignal.timeout(10000) });
    $('result').textContent = r.ok ? 'Backend and service key verified.' : `Connection rejected (HTTP ${r.status}).`;
  } catch (error) { $('result').textContent = error.message; }
};
chrome.storage.onChanged.addListener(c => { if (c.observerStatus) $('status').textContent = JSON.stringify(c.observerStatus.newValue); });