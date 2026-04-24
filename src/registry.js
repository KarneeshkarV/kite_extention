(function () {
  'use strict';
  // Features self-register into window.__KiteExt.features when their script loads.
  // This file is loaded after all feature scripts, so it just guarantees the
  // array exists and is a single source of truth for the loader.
  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.features = ns.features || [];
})();
