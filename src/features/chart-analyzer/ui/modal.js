(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  let current = null;

  function closeCurrent(result) {
    if (!current) return;
    const { root, resolve, keyHandler } = current;
    document.removeEventListener('keydown', keyHandler, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    current = null;
    try { resolve(result); } catch (_) { /* noop */ }
  }

  function openProviderModal() {
    // If already open, resolve the previous and reopen.
    if (current) closeCurrent(null);

    const providers = ns.chartAnalyzer.providers || [];

    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'kite-ext-ca-modal-backdrop';
      root.innerHTML = `
        <div class="kite-ext-ca-modal" role="dialog" aria-modal="true" aria-label="Choose AI provider">
          <div class="kite-ext-ca-modal-header">
            <h3>Analyze chart with</h3>
            <button type="button" class="kite-ext-ca-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="kite-ext-ca-modal-body"></div>
          <div class="kite-ext-ca-modal-footer">
            <span class="kite-ext-ca-hint">Requires local server at localhost:8000</span>
          </div>
        </div>
      `;

      const body = root.querySelector('.kite-ext-ca-modal-body');
      providers.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kite-ext-ca-provider-btn';
        btn.dataset.providerId = p.id;
        btn.innerHTML = `
          <span class="kite-ext-ca-provider-label">${p.label}</span>
          <span class="kite-ext-ca-provider-model">${p.model}</span>
          ${p.supportsVision ? '' : '<span class="kite-ext-ca-provider-tag">text-only for now</span>'}
        `;
        btn.addEventListener('click', () => closeCurrent(p));
        body.appendChild(btn);
      });

      root.querySelector('.kite-ext-ca-modal-close').addEventListener('click', () => closeCurrent(null));
      root.addEventListener('click', (e) => {
        if (e.target === root) closeCurrent(null);
      });

      const keyHandler = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeCurrent(null);
        }
      };
      document.addEventListener('keydown', keyHandler, true);

      document.body.appendChild(root);
      current = { root, resolve, keyHandler };
    });
  }

  function closeProviderModal() {
    closeCurrent(null);
  }

  ns.chartAnalyzer.openProviderModal = openProviderModal;
  ns.chartAnalyzer.closeProviderModal = closeProviderModal;
})();
