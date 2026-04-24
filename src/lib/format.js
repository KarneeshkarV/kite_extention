(function () {
  'use strict';

  const inrFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function inr(n) {
    if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return '—';
    return inrFormatter.format(n);
  }

  function parseNumeric(text) {
    if (text == null) return NaN;
    const cleaned = String(text).replace(/[₹,\s]/g, '').replace(/[−–—]/g, '-');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.format = { inr, parseNumeric };
})();
