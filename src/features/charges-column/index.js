(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  const NEW_HEADERS = [
    { key: 'brokerage', label: 'Brokerage', title: 'Estimated brokerage for this position' },
    { key: 'stt', label: 'STT/CTT', title: 'Estimated STT/CTT for this position' },
    { key: 'total', label: 'Total Charges', title: 'Estimated brokerage + taxes. Final figures on the contract note.' },
    { key: 'netpnl', label: 'Net P&L', title: 'Gross P&L minus estimated total charges.' },
  ];
  const REQUIRED_HEADERS = ['instrument', 'qty', 'avg', 'ltp'];

  let disconnectObserver = null;
  let cancelled = false;
  let snapshot = {}; // key -> { buy_avg, qty, ts }
  let lastFound = null;
  let mode = 'positions'; // 'positions' | 'holdings'

  function discoverOptionalColumns(thead, headerIndex) {
    const ths = thead.querySelectorAll('tr > th');
    ths.forEach((th, i) => {
      // Skip headers we injected — "Net P&L" would otherwise match the p&l rule
      // and cause extractRowData to read its own prior output as gross P&L.
      if (th.classList.contains('kite-ext-col')) return;
      const t = ns.dom.norm(th.textContent);
      if (t === 'product' || t.startsWith('product')) headerIndex.product = i;
      if (t === 'p&l' || t.includes('p&l') || t.includes('pnl') || t.includes('p & l')) headerIndex.pnl = i;
    });
  }

  function extractRowData(row, headerIndex) {
    const cells = row.querySelectorAll('td');
    const instrumentCell = cells[headerIndex.instrument];
    if (!instrumentCell) return null;

    const instrumentSpans = Array.from(instrumentCell.querySelectorAll('span, small'));
    let tradingsymbol = '';
    let exchange = '';

    if (instrumentSpans.length >= 2) {
      tradingsymbol = (instrumentSpans[0].textContent || '').trim().toUpperCase();
      const tail = (instrumentSpans[instrumentSpans.length - 1].textContent || '').trim().toUpperCase();
      if (/^(NSE|BSE|NFO|BFO|CDS|BCD|MCX)$/.test(tail)) exchange = tail;
    }
    if (!tradingsymbol) {
      const tokens = (instrumentCell.textContent || '').toUpperCase().trim().split(/\s+/);
      tradingsymbol = tokens[0] || '';
      // Only treat the trailing token as an exchange tag when it's distinct
      // from the symbol — otherwise tickers like "MCX" (the stock) get
      // misread as the MCX commodity exchange.
      if (tokens.length > 1) {
        const tail = tokens[tokens.length - 1] || '';
        if (/^(NSE|BSE|NFO|BFO|CDS|BCD|MCX)$/.test(tail)) exchange = tail;
      }
    }

    const productCell = headerIndex.product != null ? cells[headerIndex.product] : null;
    let product = productCell ? (productCell.textContent || '').trim().toUpperCase() : '';

    // Holdings are always delivery (CNC) on NSE/BSE; the holdings UI usually
    // doesn't render the exchange tag inline, so fill in safe defaults.
    if (mode === 'holdings') {
      if (!product) product = 'CNC';
      if (!exchange) exchange = 'NSE';
    }

    return {
      tradingsymbol,
      exchange,
      product,
      qty: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'qty')),
      buy_avg: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'avg')),
      ltp: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'ltp')),
      pnl: headerIndex.pnl != null ? ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'pnl')) : NaN,
    };
  }

  // Brokerage on EQ_DELIVERY is always ₹0, so the column is dead weight on the
  // Holdings tab — hide it there.
  function activeHeaders() {
    return mode === 'holdings'
      ? NEW_HEADERS.filter((h) => h.key !== 'brokerage')
      : NEW_HEADERS;
  }

  function ensureHeaders(thead, headerRow) {
    const headers = activeHeaders();
    const existing = thead.querySelectorAll('th.kite-ext-col');
    const existingKeys = Array.from(existing).map((th) => th.dataset.key || '');
    const desiredKeys = headers.map((h) => h.key);
    const matches = existing.length === headers.length &&
      existingKeys.every((k, i) => k === desiredKeys[i]);
    if (matches) return;
    existing.forEach((n) => n.remove());
    for (const h of headers) {
      const th = document.createElement('th');
      th.className = 'kite-ext-col kite-ext-col-' + h.key;
      th.dataset.key = h.key;
      th.textContent = h.label;
      th.title = h.title;
      headerRow.appendChild(th);
    }
  }

  function ensureRowCells(row) {
    const headers = activeHeaders();
    const existing = row.querySelectorAll('td.kite-ext-cell');
    const existingKeys = Array.from(existing).map((td) => td.dataset.key || '');
    const desiredKeys = headers.map((h) => h.key);
    const matches = existing.length === headers.length &&
      existingKeys.every((k, i) => k === desiredKeys[i]);
    if (matches) return Array.from(existing);
    existing.forEach((n) => n.remove());
    const cells = [];
    for (const h of headers) {
      const td = document.createElement('td');
      td.className = 'kite-ext-cell kite-ext-est kite-ext-cell-' + h.key;
      td.dataset.key = h.key;
      row.appendChild(td);
      cells.push(td);
    }
    return cells;
  }

  function computeForRow(data) {
    const key = ns.storage.keyFor(data);
    const absQty = Math.abs(data.qty);

    // OPEN position: qty ≠ 0 and buy_avg known.
    if (absQty && Number.isFinite(data.buy_avg) && data.buy_avg > 0) {
      const record = { buy_avg: data.buy_avg, qty: data.qty };
      snapshot[key] = { ...record, ts: Date.now() };
      ns.storage.set(key, record);

      const charges = ns.charges.calculateCharges({
        exchange: data.exchange,
        tradingsymbol: data.tradingsymbol,
        product: data.product,
        qty: data.qty,
        buy_avg: data.buy_avg,
        ltp: data.ltp,
      });
      const grossPnl = Number.isFinite(data.pnl)
        ? data.pnl
        : (Number.isFinite(data.ltp) ? (data.ltp - data.buy_avg) * data.qty : NaN);
      const netPnl = Number.isFinite(grossPnl) && Number.isFinite(charges.total)
        ? grossPnl - charges.total
        : NaN;
      return { charges, netPnl, source: 'open' };
    }

    // CLOSED position: qty = 0. Reconstruct from stored buy_avg + visible P&L.
    const stored = snapshot[key];
    if (!absQty && stored && Number.isFinite(data.pnl) && stored.buy_avg && stored.qty) {
      const q = Math.abs(stored.qty);
      const buyValue = stored.buy_avg * q;
      const sellValue = buyValue + data.pnl;
      const sellAvg = sellValue / q;
      const charges = ns.charges.calculateCharges({
        exchange: data.exchange,
        tradingsymbol: data.tradingsymbol,
        product: data.product,
        qty: stored.qty,
        buy_avg: stored.buy_avg,
        sell_avg: sellAvg,
      });
      const netPnl = Number.isFinite(charges.total) ? data.pnl - charges.total : NaN;
      return { charges, netPnl, source: 'closed-reconstructed' };
    }

    return null;
  }

  function writeCells(cells, result) {
    const byKey = {};
    cells.forEach((c) => { byKey[c.dataset.key] = c; });
    if (!result) {
      cells.forEach((c) => {
        c.textContent = '—';
        c.classList.remove('kite-ext-pos', 'kite-ext-neg');
      });
      return;
    }
    const { charges, netPnl } = result;
    if (byKey.brokerage) byKey.brokerage.textContent = ns.format.inr(charges.brokerage);
    if (byKey.stt) byKey.stt.textContent = ns.format.inr(charges.stt);
    if (byKey.total) byKey.total.textContent = ns.format.inr(charges.total);
    if (byKey.netpnl) {
      byKey.netpnl.textContent = ns.format.inr(netPnl);
      byKey.netpnl.classList.toggle('kite-ext-pos', Number.isFinite(netPnl) && netPnl > 0);
      byKey.netpnl.classList.toggle('kite-ext-neg', Number.isFinite(netPnl) && netPnl < 0);
    }
  }

  function renderTable(found) {
    const { table, headerIndex } = found;
    const thead = table.querySelector('thead');
    const headerRow = thead && thead.querySelector('tr');
    if (!thead || !headerRow) return;

    discoverOptionalColumns(thead, headerIndex);
    ensureHeaders(thead, headerRow);

    // Largest header index we need to address — used to spot rows that span
    // columns (e.g. the holdings "Total" row uses colspan and so has fewer tds).
    const maxIdx = Math.max(
      headerIndex.instrument ?? -1,
      headerIndex.qty ?? -1,
      headerIndex.avg ?? -1,
      headerIndex.ltp ?? -1,
      headerIndex.pnl ?? -1,
    );

    const rows = table.querySelectorAll('tbody > tr');
    rows.forEach((row) => {
      const tds = row.querySelectorAll('td');
      const instrumentText = tds[headerIndex.instrument]
        ? ns.dom.norm(tds[headerIndex.instrument].textContent)
        : '';
      const looksLikeTotal =
        row.classList.contains('total') ||
        !!row.querySelector('th') ||
        instrumentText === 'total' ||
        instrumentText.startsWith('total ') ||
        tds.length <= maxIdx;
      if (looksLikeTotal) {
        // Don't inject placeholder cells into spanning/total rows.
        row.querySelectorAll('td.kite-ext-cell').forEach((n) => n.remove());
        return;
      }
      const data = extractRowData(row, headerIndex);
      const cells = ensureRowCells(row);
      if (!data) { writeCells(cells, null); return; }
      writeCells(cells, computeForRow(data));
    });
  }

  function removeInjections() {
    document.querySelectorAll('.kite-ext-col, .kite-ext-cell').forEach((n) => n.remove());
  }

  const feature = {
    id: 'charges-column',
    match: (url) => {
      try {
        const path = new URL(url).pathname;
        return path.includes('/positions') || path.includes('/holdings');
      } catch { return false; }
    },
    activate(ctx) {
      cancelled = false;
      try {
        mode = location.pathname.includes('/holdings') ? 'holdings' : 'positions';
      } catch { mode = 'positions'; }
      ctx.log('charges-column activated', mode);

      // Start observer immediately so open positions render without waiting for storage.
      disconnectObserver = ns.dom.observeDom(() => {
        // SPA may swap /positions <-> /holdings without re-activating the feature,
        // so refresh mode each tick.
        try {
          mode = location.pathname.includes('/holdings') ? 'holdings' : 'positions';
        } catch { /* keep prior mode */ }
        const found = ns.dom.findTableByHeaders(REQUIRED_HEADERS);
        if (!found) return;
        lastFound = found;
        renderTable(found);
      }, 250);

      // Hydrate snapshot from storage, then force a re-render so closed rows resolve.
      ns.storage.getAll().then((data) => {
        if (cancelled) return;
        snapshot = data;
        ctx.log('hydrated', Object.keys(snapshot).length, 'stored positions');
        if (lastFound) renderTable(lastFound);
      });
    },
    deactivate() {
      cancelled = true;
      if (disconnectObserver) { disconnectObserver(); disconnectObserver = null; }
      lastFound = null;
      removeInjections();
    },
  };

  ns.features = ns.features || [];
  ns.features.push(feature);
})();
