(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  if (ns.__loaderStarted) return;
  ns.__loaderStarted = true;

  const log = (...args) => {
    try {
      if (localStorage.getItem('kiteExtDebug')) console.log('[KiteExt]', ...args);
    } catch (_) { /* localStorage may be blocked */ }
  };

  const active = new Map(); // feature.id -> feature

  function ctxFor() {
    return { log };
  }

  function evaluate() {
    const url = location.href;
    const features = ns.features || [];
    // Deactivate first (so DOM is clean before re-activation).
    for (const [id, feat] of Array.from(active.entries())) {
      let match = false;
      try { match = !!feat.match(url); } catch (e) { log(id, 'match error', e); }
      if (!match) {
        try { feat.deactivate(); } catch (e) { log(id, 'deactivate error', e); }
        active.delete(id);
      }
    }
    // Activate newly matched features.
    for (const feat of features) {
      if (active.has(feat.id)) continue;
      let match = false;
      try { match = !!feat.match(url); } catch (e) { log(feat.id, 'match error', e); }
      if (!match) continue;
      try {
        feat.activate(ctxFor());
        active.set(feat.id, feat);
      } catch (e) {
        log(feat.id, 'activate error', e);
      }
    }
  }

  function hookHistory() {
    const emit = () => setTimeout(evaluate, 0);
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      emit();
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      emit();
      return r;
    };
    window.addEventListener('popstate', emit);
    window.addEventListener('hashchange', emit);
  }

  hookHistory();
  // Initial evaluation — features may want to attach their own observers
  // for DOM readiness; we don't wait for DOMContentLoaded since content
  // scripts at document_idle already have a body.
  evaluate();
  log('loader ready, features registered:', (ns.features || []).map((f) => f.id));
})();
