(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  const ca = (ns.chartAnalyzer = ns.chartAnalyzer || {});

  const MARK_ATTR = 'data-kite-ext-analyzer';
  const CHART_SELECTORS = [
    '.chart-iq',
    '[class*="chartIQ"]',
    '.charting-library-container',
    '[class*="charting_library"]',
    '[class*="tradingview"]',
    '[class*="tv-chart"]',
    '[class*="chart-container"]',
    '[id*="tv_chart_container"]',
    'iframe[src*="tradingview"]',
  ];
  const MIN_W = 400;
  const MIN_H = 200;
  // Tag name of elements we refuse to walk up into (global page layout chrome).
  const STOP_TAGS = new Set(['BODY', 'HTML', 'MAIN']);
  const ACTIVE_CLASS_RE = /\b(active|selected|current|checked|highlight|focused|on)\b/i;
  const TICKER_HINT_RE = /(instrument|symbol|ticker|tradingsymbol|scrip|contract|header|title|name)/i;
  const UI_NOISE_RE = /\b(indicators?|studies?|templates?|compare|alert|alerts|depth|settings?|layout|save|publish|buy|sell|orders?|positions?|holdings?|market\s*depth|chart|option\s*chain|analytics?)\b/i;

  let disconnectObserver = null;
  let inFlightAbort = null;
  let log = () => {};
  // Always-on console trace so the user can see what's being detected
  // without having to set localStorage.kiteExtDebug.
  const trace = (...args) => console.log('[KiteExt:chart-analyzer]', ...args);

  function isReasonablySized(el) {
    const r = el.getBoundingClientRect();
    return r.width >= MIN_W && r.height >= MIN_H;
  }

  // Walk up from a big canvas to find the natural chart wrapper — the first
  // ancestor that's meaningfully bigger than the canvas itself (so we clear
  // stacked canvases like main/volume/crosshair) and isn't a page-level node.
  function ancestorWrapper(canvas) {
    const rc = canvas.getBoundingClientRect();
    let el = canvas.parentElement;
    let last = null;
    for (let i = 0; i < 10 && el && !STOP_TAGS.has(el.tagName); i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      last = el;
      // Stop once we've walked into something notably taller than the canvas
      // (i.e. includes the toolbar/x-axis around the plotting area).
      if (r.height >= rc.height + 40 || r.width >= rc.width + 40) return el;
    }
    return last;
  }

  function findChartContainers() {
    const found = new Set();
    // 1) Named selectors.
    for (const sel of CHART_SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => {
        if (isReasonablySized(el)) found.add(el);
      });
    }
    // 2) Canvas-based detection (always on — covers Kite's TradingView v2
    //    which uses class names we can't enumerate reliably).
    document.querySelectorAll('canvas').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) return;
      const wrap = ancestorWrapper(c);
      if (wrap) found.add(wrap);
    });
    // 3) Collapse nested matches — keep only the outermost container, BUT
    //    iframes win over any outer wrapper that contains them, because
    //    the chart is actually rendered inside the iframe and we want the
    //    button positioned against the iframe's edge.
    const arr = Array.from(found);
    const iframes = arr.filter((a) => a.tagName === 'IFRAME');
    return arr.filter((a) => {
      if (a.tagName === 'IFRAME') return true;
      if (iframes.some((f) => a.contains(f))) return false;
      return !arr.some((b) => b !== a && b.tagName !== 'IFRAME' && b.contains(a));
    });
  }

  // For a detected chart element, figure out:
  //   - host: where the Analyze button gets appended (must be a real container,
  //           not an <iframe> since iframes don't render light-DOM children)
  //   - target: what gets screenshotted (the iframe itself, or the container)
  function resolveHostAndTarget(container) {
    if (container.tagName === 'IFRAME') {
      const host = container.parentElement;
      return host ? { host, target: container } : null;
    }
    return { host: container, target: container };
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isActiveLike(el) {
    if (!el) return false;
    if (el.getAttribute('aria-selected') === 'true') return true;
    if (el.getAttribute('aria-pressed') === 'true') return true;
    if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') return true;
    const cls = `${el.className || ''} ${el.id || ''}`;
    return ACTIVE_CLASS_RE.test(cls);
  }

  function normalizeRange(text) {
    const t = cleanText(text).toUpperCase();
    if (!t) return null;
    if (/^(YTD|MAX)$/.test(t)) return t;
    let m = t.match(/^(\d+)\s*(D|W|M|Y)$/);
    if (m) return `${m[1]}${m[2]}`;
    m = t.match(/^(\d+)\s*(DAY|DAYS|WEEK|WEEKS|MONTH|MONTHS|YEAR|YEARS)$/);
    if (!m) return null;
    const map = { DAY: 'D', DAYS: 'D', WEEK: 'W', WEEKS: 'W', MONTH: 'M', MONTHS: 'M', YEAR: 'Y', YEARS: 'Y' };
    return `${m[1]}${map[m[2]]}`;
  }

  function normalizeInterval(text) {
    const t = cleanText(text).toLowerCase();
    if (!t) return null;
    const m = t.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months)$/i);
    if (!m) return null;
    const unit = m[2].toLowerCase();
    const map = {
      s: 'sec', sec: 'sec', secs: 'sec', second: 'sec', seconds: 'sec',
      m: 'min', min: 'min', mins: 'min', minute: 'min', minutes: 'min',
      h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
      d: 'day', day: 'day', days: 'day',
      w: 'week', wk: 'week', wks: 'week', week: 'week', weeks: 'week',
      mo: 'month', month: 'month', months: 'month',
    };
    return `${m[1]} ${map[unit]}`;
  }

  function looksLikeTicker(text) {
    const t = cleanText(text);
    if (!t || t.length < 2 || t.length > 40) return false;
    if (UI_NOISE_RE.test(t)) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    if (t.includes('\n')) return false;
    const tokens = t.split(' ');
    if (tokens.length > 6) return false;
    if (tokens.some((token) => token.length > 20)) return false;
    return /^[A-Za-z0-9&._:-]+(?: [A-Za-z0-9&._:-]+){0,5}$/.test(t);
  }

  function collectContextRoots(container) {
    const roots = [];
    const add = (el) => {
      if (!el || roots.includes(el)) return;
      roots.push(el);
    };
    add(container);
    add(container.parentElement);
    add(container.parentElement?.previousElementSibling);
    add(container.parentElement?.nextElementSibling);

    let el = container.parentElement;
    for (let i = 0; i < 3 && el && !STOP_TAGS.has(el.tagName); i++, el = el.parentElement) {
      add(el);
      add(el.previousElementSibling);
      add(el.nextElementSibling);
    }

    return roots.filter(Boolean);
  }

  function collectTextCandidates(roots) {
    const items = [];
    const seen = new Set();
    const selectors = [
      'button',
      '[role="button"]',
      '[role="tab"]',
      '[aria-selected]',
      '[aria-pressed]',
      '[aria-current]',
      'h1',
      'h2',
      'h3',
      '[class*="header"]',
      '[class*="title"]',
      '[class*="symbol"]',
      '[class*="ticker"]',
      '[class*="instrument"]',
      '[class*="tradingsymbol"]',
      '[class*="range"]',
      '[class*="interval"]',
      '[class*="time"]',
    ].join(',');

    roots.forEach((root, rootIndex) => {
      if (!isVisible(root)) return;
      const nodes = root.matches?.(selectors) ? [root] : [];
      root.querySelectorAll?.(selectors).forEach((node) => nodes.push(node));
      nodes.forEach((node) => {
        if (!isVisible(node)) return;
        const text = cleanText(node.innerText || node.textContent);
        if (!text || text.length > 60) return;
        const key = `${rootIndex}:${node.tagName}:${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ node, text, rootIndex });
      });
    });

    return items;
  }

  function pickRange(candidates) {
    const ranked = candidates
      .map((item) => {
        const value = normalizeRange(item.text);
        if (!value) return null;
        return {
          value,
          score: (isActiveLike(item.node) ? 10 : 0) + (10 - item.rootIndex),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.value || null;
  }

  function pickInterval(candidates) {
    const ranked = candidates
      .map((item) => {
        const value = normalizeInterval(item.text);
        if (!value) return null;
        return {
          value,
          score: (isActiveLike(item.node) ? 10 : 0) + (10 - item.rootIndex),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.value || null;
  }

  function pickTicker(candidates) {
    const ranked = candidates
      .map((item) => {
        if (!looksLikeTicker(item.text)) return null;
        const attrs = `${item.node.className || ''} ${item.node.id || ''}`;
        let score = 10 - item.rootIndex;
        if (isActiveLike(item.node)) score += 6;
        if (TICKER_HINT_RE.test(attrs)) score += 10;
        if (/^H[1-3]$/.test(item.node.tagName)) score += 4;
        if (/[A-Z]/.test(item.text) && item.text === item.text.toUpperCase()) score += 3;
        if (item.text.length <= 20) score += 2;
        return { value: item.text, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.value || null;
  }

  function extractChartContext(container) {
    const roots = collectContextRoots(container);
    const candidates = collectTextCandidates(roots);
    return {
      ticker: pickTicker(candidates),
      range: pickRange(candidates),
      interval: pickInterval(candidates),
    };
  }

  function attachButton(container) {
    if (container.getAttribute(MARK_ATTR)) return;
    const pair = resolveHostAndTarget(container);
    if (!pair) return;
    const { host, target } = pair;

    // If the host already has a button (e.g. because we also matched a
    // sibling canvas inside it), skip.
    if (host.querySelector(':scope > .kite-ext-ca-btn')) {
      container.setAttribute(MARK_ATTR, 'skip');
      return;
    }
    container.setAttribute(MARK_ATTR, '1');
    host.setAttribute(MARK_ATTR + '-host', '1');

    // Ensure the host can position an absolutely-placed child.
    const computed = getComputedStyle(host);
    if (computed.position === 'static') {
      host.style.position = 'relative';
      host.setAttribute(MARK_ATTR + '-pos', '1');
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kite-ext-ca-btn';
    btn.textContent = 'Analyze';
    btn.title = 'Analyze this chart with AI';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runAnalysis(target).catch((err) => log('analysis error', err));
    });

    host.appendChild(btn);
    trace('attached button to host', host, 'for target', target);
  }

  function removeButtons() {
    document.querySelectorAll('.kite-ext-ca-btn').forEach((b) => b.remove());
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
    document.querySelectorAll(`[${MARK_ATTR}-host]`).forEach((el) => el.removeAttribute(MARK_ATTR + '-host'));
    document.querySelectorAll(`[${MARK_ATTR}-pos]`).forEach((el) => {
      el.style.position = '';
      el.removeAttribute(MARK_ATTR + '-pos');
    });
  }

  async function runAnalysis(container) {
    const provider = await ca.openProviderModal();
    if (!provider) { log('user cancelled provider selection'); return; }

    // Cancel any previous in-flight request.
    if (inFlightAbort) {
      try { inFlightAbort.abort(); } catch (_) {}
    }
    const controller = new AbortController();
    inFlightAbort = controller;
    const chartContext = extractChartContext(container);

    // Capture BEFORE showing the drawer — the drawer slides in from the right
    // and would otherwise occlude the chart in the screenshot.
    let dataUrl;
    try {
      dataUrl = await ca.captureElement(container);
    } catch (err) {
      log('capture failed', err);
      ca.showDrawer({
        state: 'error',
        provider,
        data: { message: `Could not capture chart: ${err.message}`, retry: () => runAnalysis(container) },
      });
      return;
    }

    ca.showDrawer({ state: 'loading', provider, data: { dataUrl } });

    try {
      trace('chart context', chartContext);
      const { text, modelUsed } = await ca.analyzeChart({ dataUrl, provider, signal: controller.signal, chartContext });
      const parsed = ca.parseAnalysis(text);
      ca.showDrawer({
        state: 'success',
        provider,
        data: { rawText: text, parsed, modelUsed, dataUrl },
      });
    } catch (err) {
      if (err.name === 'AbortError') { log('analysis aborted'); return; }
      log('analysis failed', err);
      ca.showDrawer({
        state: 'error',
        provider,
        data: { message: err.message, retry: () => runAnalysis(container), dataUrl },
      });
    } finally {
      if (inFlightAbort === controller) inFlightAbort = null;
    }
  }

  function scan() {
    const containers = findChartContainers();
    if (containers.length === 0) {
      // One-shot signal so the user can tell the scan ran but found nothing.
      if (!window.__kiteExtChartEmpty) {
        window.__kiteExtChartEmpty = true;
        trace('scan ran, no chart containers matched yet');
      }
      return;
    }
    window.__kiteExtChartEmpty = false;
    containers.forEach(attachButton);
  }

  const feature = {
    id: 'chart-analyzer',
    match: () => true, // observer inside activate gates on actual chart presence
    activate(ctx) {
      log = ctx.log;
      trace('activated on', location.href);
      disconnectObserver = ns.dom.observeDom(scan, 300);
    },
    deactivate() {
      log('chart-analyzer deactivated');
      if (disconnectObserver) { try { disconnectObserver(); } catch (_) {} disconnectObserver = null; }
      if (inFlightAbort) { try { inFlightAbort.abort(); } catch (_) {} inFlightAbort = null; }
      removeButtons();
      if (ca.closeProviderModal) ca.closeProviderModal();
      if (ca.closeDrawer) ca.closeDrawer();
    },
  };

  ns.features = ns.features || [];
  ns.features.push(feature);
})();
