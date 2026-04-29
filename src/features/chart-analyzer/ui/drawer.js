(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  let root = null;
  let onRetry = null;

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('aside');
    root.className = 'kite-ext-ca-drawer';
    root.innerHTML = `
      <header class="kite-ext-ca-drawer-header">
        <div class="kite-ext-ca-drawer-title">
          <span class="kite-ext-ca-drawer-label">AI Analysis</span>
          <span class="kite-ext-ca-drawer-model" data-role="model"></span>
        </div>
        <button type="button" class="kite-ext-ca-drawer-close" aria-label="Close">&times;</button>
      </header>
      <div class="kite-ext-ca-drawer-body" data-role="body"></div>
    `;
    root.querySelector('.kite-ext-ca-drawer-close').addEventListener('click', close);
    document.body.appendChild(root);
    // Force reflow then add "open" class so the slide-in transition plays.
    // eslint-disable-next-line no-unused-expressions
    root.offsetWidth;
    root.classList.add('kite-ext-ca-drawer-open');
    return root;
  }

  function close() {
    if (!root) return;
    root.classList.remove('kite-ext-ca-drawer-open');
    const node = root;
    root = null;
    setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
  }

  function imagePreviewHtml(dataUrl) {
    if (!dataUrl) return '';
    return `
      <section class="kite-ext-ca-preview">
        <h4>Captured chart</h4>
        <a href="${dataUrl}" target="_blank" rel="noopener">
          <img src="${dataUrl}" alt="Captured chart" />
        </a>
      </section>
    `;
  }

  function renderLoading(provider, dataUrl) {
    const r = ensureRoot();
    r.querySelector('[data-role="model"]').textContent = provider ? `${provider.label} · ${provider.model}` : '';
    const label = provider ? provider.label : 'the model';
    const msg = dataUrl ? `Waiting for ${label} to analyze…` : `Capturing chart…`;
    r.querySelector('[data-role="body"]').innerHTML = `
      ${imagePreviewHtml(dataUrl)}
      <div class="kite-ext-ca-loading">
        <div class="kite-ext-ca-spinner" aria-hidden="true"></div>
        <p>${msg}</p>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function fmtLevel(v) {
    if (v == null) return '—';
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }
    return escapeHtml(v);
  }

  function fmtLevels(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '—';
    return arr.map(fmtLevel).join(', ');
  }

  function hasRange(parsed) {
    return parsed && (parsed.range_low != null || parsed.range_high != null);
  }

  function hasPlan(parsed) {
    return parsed && (parsed.stop_loss != null || parsed.target != null);
  }

  function hasLevels(parsed) {
    return Boolean(
      parsed
      && ((Array.isArray(parsed.support) && parsed.support.length) || (Array.isArray(parsed.resistance) && parsed.resistance.length))
    );
  }

  function safeHttpUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (_) {
      return '';
    }
  }

  function webSourcesHtml(sources) {
    if (!Array.isArray(sources) || !sources.length) return '';
    const items = sources
      .map((source) => {
        const url = safeHttpUrl(source?.url);
        if (!url) return '';
        const title = escapeHtml(source?.title || url);
        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a></li>`;
      })
      .filter(Boolean)
      .join('');
    if (!items) return '';
    return `<section class="kite-ext-ca-sources"><h4>Web sources</h4><ul>${items}</ul></section>`;
  }

  function rawBlocksHtml(rawText, rawJson) {
    const blocks = [];
    if (rawText) {
      blocks.push(`
        <details class="kite-ext-ca-raw">
          <summary>Raw response</summary>
          <pre>${escapeHtml(rawText)}</pre>
        </details>
      `);
    }
    if (rawJson !== undefined && rawJson !== null) {
      let serialized;
      try { serialized = JSON.stringify(rawJson, null, 2); }
      catch (_) { serialized = String(rawJson); }
      blocks.push(`
        <details class="kite-ext-ca-raw">
          <summary>See raw JSON</summary>
          <pre>${escapeHtml(serialized)}</pre>
        </details>
      `);
    }
    return blocks.join('');
  }

  function renderSuccess({ provider, rawText, rawJson, parsed, modelUsed, dataUrl }) {
    const r = ensureRoot();
    const shownModel = modelUsed || provider?.model || '';
    const fellBack = modelUsed && provider?.model && modelUsed !== provider.model;
    r.querySelector('[data-role="model"]').textContent = provider
      ? `${provider.label} · ${shownModel}${fellBack ? ' (fallback)' : ''}`
      : '';
    const body = r.querySelector('[data-role="body"]');

    const imgHtml = imagePreviewHtml(dataUrl);
    const rawHtml = rawBlocksHtml(rawText, rawJson);
    if (parsed) {
      const trend = escapeHtml(parsed.trend || '—');
      const bias = escapeHtml(parsed.bias || '—');
      const call = escapeHtml(parsed.call || '—');
      const notes = escapeHtml(parsed.notes || '');
      body.innerHTML = `
        ${imgHtml}
        <section class="kite-ext-ca-summary">
          <div class="kite-ext-ca-kv"><span>Trend</span><strong>${trend}</strong></div>
          <div class="kite-ext-ca-kv"><span>Bias</span><strong class="kite-ext-ca-bias-${escapeHtml((parsed.bias || '').toLowerCase())}">${bias}</strong></div>
          <div class="kite-ext-ca-kv"><span>Call</span><strong class="kite-ext-ca-call-${escapeHtml((parsed.call || '').toLowerCase())}">${call}</strong></div>
        </section>
        ${hasPlan(parsed) ? `<section class="kite-ext-ca-range">
          <h4>Educational estimates</h4>
          <div class="kite-ext-ca-range-row">
            <div><span>Stop loss</span><strong>${fmtLevel(parsed.stop_loss)}</strong></div>
            <div><span>Target</span><strong>${fmtLevel(parsed.target)}</strong></div>
          </div>
        </section>` : ''}
        ${hasRange(parsed) ? `<section class="kite-ext-ca-range">
          <h4>Suggested range</h4>
          <div class="kite-ext-ca-range-row">
            <div><span>Low</span><strong>${fmtLevel(parsed.range_low)}</strong></div>
            <div><span>High</span><strong>${fmtLevel(parsed.range_high)}</strong></div>
          </div>
        </section>` : ''}
        ${hasLevels(parsed) ? `<section class="kite-ext-ca-levels">
          <div><h4>Support</h4><p>${fmtLevels(parsed.support)}</p></div>
          <div><h4>Resistance</h4><p>${fmtLevels(parsed.resistance)}</p></div>
        </section>` : ''}
        ${notes ? `<section class="kite-ext-ca-notes"><h4>Notes</h4><p>${notes}</p></section>` : ''}
        ${webSourcesHtml(parsed.web_sources)}
        ${rawHtml}
      `;
    } else {
      body.innerHTML = `
        ${imgHtml}
        <section class="kite-ext-ca-notes">
          <h4>Response</h4>
          <pre class="kite-ext-ca-freeform">${escapeHtml(rawText || '(empty)')}</pre>
        </section>
        ${rawHtml}
      `;
    }
  }

  function renderError({ provider, message, retry, dataUrl }) {
    onRetry = typeof retry === 'function' ? retry : null;
    const r = ensureRoot();
    r.querySelector('[data-role="model"]').textContent = provider ? `${provider.label} · ${provider.model}` : '';
    r.querySelector('[data-role="body"]').innerHTML = `
      ${imagePreviewHtml(dataUrl)}
      <div class="kite-ext-ca-error">
        <p class="kite-ext-ca-error-msg">${escapeHtml(message || 'Something went wrong')}</p>
        <p class="kite-ext-ca-error-hint">
          Make sure the chat_to_llm server is running:<br>
          <code>cd /home/karneeshkar/Desktop/personal/chat_to_llm &amp;&amp; uv run python app.py</code>
        </p>
        ${onRetry ? '<button type="button" class="kite-ext-ca-retry">Retry</button>' : ''}
      </div>
    `;
    const btn = r.querySelector('.kite-ext-ca-retry');
    if (btn) btn.addEventListener('click', () => { if (onRetry) onRetry(); });
  }

  function showDrawer({ state, data, provider }) {
    if (state === 'loading') return renderLoading(provider, data?.dataUrl);
    if (state === 'success') return renderSuccess({ provider, ...(data || {}) });
    if (state === 'error')   return renderError({ provider, ...(data || {}) });
    throw new Error(`showDrawer: unknown state ${state}`);
  }

  ns.chartAnalyzer.showDrawer = showDrawer;
  ns.chartAnalyzer.closeDrawer = close;
})();
