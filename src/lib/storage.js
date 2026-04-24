(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  const PREFIX = 'kiteExt:pos:';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — drop yesterday's trades

  const api =
    (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ||
    (typeof browser !== 'undefined' && browser.storage && browser.storage.local) ||
    null;

  function keyFor({ exchange, tradingsymbol, product }) {
    return `${exchange || ''}:${tradingsymbol || ''}:${product || ''}`.toUpperCase();
  }

  async function getAll() {
    if (!api) return {};
    return new Promise((resolve) => {
      try {
        api.get(null, (items) => {
          const now = Date.now();
          const out = {};
          for (const [k, v] of Object.entries(items || {})) {
            if (!k.startsWith(PREFIX)) continue;
            if (!v || !v.ts || now - v.ts > MAX_AGE_MS) continue;
            out[k.slice(PREFIX.length)] = v;
          }
          resolve(out);
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function set(key, value) {
    if (!api) return;
    try {
      api.set({ [PREFIX + key]: { ...value, ts: Date.now() } });
    } catch (_) { /* ignore quota / context-invalidated */ }
  }

  function clear() {
    if (!api) return;
    try {
      api.get(null, (items) => {
        const keys = Object.keys(items || {}).filter((k) => k.startsWith(PREFIX));
        if (keys.length) api.remove(keys);
      });
    } catch (_) {}
  }

  ns.storage = { getAll, set, keyFor, clear };
})();
