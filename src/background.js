'use strict';

const inFlightFetches = new Map();

async function doBackendFetch(msg, sendResponse) {
  const controller = new AbortController();
  if (msg.id) inFlightFetches.set(msg.id, controller);
  try {
    const res = await fetch(msg.url, {
      method: msg.method || 'GET',
      headers: msg.headers || {},
      body: msg.body,
      signal: controller.signal,
    });
    const body = await res.text();
    sendResponse({ ok: true, status: res.status, statusText: res.statusText, body });
  } catch (err) {
    sendResponse({
      ok: false,
      aborted: err && err.name === 'AbortError',
      error: (err && err.message) || String(err),
    });
  } finally {
    if (msg.id) inFlightFetches.delete(msg.id);
  }
}

function doCapture(windowId, sendResponse) {
  const opts = { format: 'png' };
  const cb = (dataUrl) => {
    const lastErr = chrome.runtime.lastError;
    if (lastErr) {
      const hint = /activeTab|permission/i.test(lastErr.message || '')
        ? ' — In Firefox, open about:addons → Kite Charges Viewer → Permissions and enable "Access your data for all websites", then reload the extension at about:debugging.'
        : '';
      sendResponse({ ok: false, error: (lastErr.message || 'captureVisibleTab failed') + hint });
      return;
    }
    if (!dataUrl) {
      sendResponse({ ok: false, error: 'captureVisibleTab returned empty' });
      return;
    }
    sendResponse({ ok: true, dataUrl });
  };

  try {
    if (typeof windowId === 'number') {
      chrome.tabs.captureVisibleTab(windowId, opts, cb);
    } else {
      chrome.tabs.captureVisibleTab(opts, cb);
    }
  } catch (e) {
    sendResponse({ ok: false, error: e.message || String(e) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'BACKEND_FETCH') {
    doBackendFetch(msg, sendResponse);
    return true;
  }
  if (msg.type === 'BACKEND_FETCH_ABORT') {
    const ctl = inFlightFetches.get(msg.id);
    if (ctl) { try { ctl.abort(); } catch (_) {} }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type !== 'CAPTURE_VISIBLE_TAB') return;
  const windowId = sender?.tab?.windowId;

  // Verify that we actually have host permission for <all_urls> before
  // trying — Firefox MV3 treats declared host_permissions as opt-in.
  try {
    chrome.permissions.contains({ origins: ['<all_urls>'] }, (hasAll) => {
      if (hasAll) return doCapture(windowId, sendResponse);
      // Fall back: maybe user granted per-site permission instead.
      chrome.permissions.contains(
        { origins: ['https://kite.zerodha.com/*'] },
        (hasKite) => {
          if (hasKite) return doCapture(windowId, sendResponse);
          sendResponse({
            ok: false,
            error:
              'Extension lacks host permission. Open about:addons → Kite Charges Viewer → Permissions, enable "Access your data for all websites", then reload the extension at about:debugging and hard-reload Kite.',
          });
        }
      );
    });
  } catch (_) {
    // chrome.permissions may not be available in some runtimes — just try.
    doCapture(windowId, sendResponse);
  }
  return true;
});
