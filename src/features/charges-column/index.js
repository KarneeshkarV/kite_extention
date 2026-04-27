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
      const tail = tokens[tokens.length - 1] || '';
      if (/^(NSE|BSE|NFO|BFO|CDS|BCD|MCX)$/.test(tail)) exchange = tail;
    }

    const productCell = headerIndex.product != null ? cells[headerIndex.product] : null;
    const product = productCell ? (productCell.textContent || '').trim().toUpperCase() : '';

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

  function ensureHeaders(thead, headerRow) {
    const existing = thead.querySelectorAll('th.kite-ext-col');
    if (existing.length === NEW_HEADERS.length) return;
    existing.forEach((n) => n.remove());
    for (const h of NEW_HEADERS) {
      const th = document.createElement('th');
      th.className = 'kite-ext-col kite-ext-col-' + h.key;
      th.textContent = h.label;
      th.title = h.title;
      headerRow.appendChild(th);
    }
  }

  function ensureRowCells(row) {
    const existing = row.querySelectorAll('td.kite-ext-cell');
    if (existing.length === NEW_HEADERS.length) return Array.from(existing);
    existing.forEach((n) => n.remove());
    const cells = [];
    for (const h of NEW_HEADERS) {
      const td = document.createElement('td');
      td.className = 'kite-ext-cell kite-ext-est kite-ext-cell-' + h.key;
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
    if (!result) {
      cells.forEach((c) => {
        c.textContent = '—';
        c.classList.remove('kite-ext-pos', 'kite-ext-neg');
      });
      return;
    }
    const { charges, netPnl } = result;
    cells[0].textContent = ns.format.inr(charges.brokerage);
    cells[1].textContent = ns.format.inr(charges.stt);
    cells[2].textContent = ns.format.inr(charges.total);
    cells[3].textContent = ns.format.inr(netPnl);
    cells[3].classList.toggle('kite-ext-pos', Number.isFinite(netPnl) && netPnl > 0);
    cells[3].classList.toggle('kite-ext-neg', Number.isFinite(netPnl) && netPnl < 0);
  }

  function renderTable(found) {
    const { table, headerIndex } = found;
    const thead = table.querySelector('thead');
    const headerRow = thead && thead.querySelector('tr');
    if (!thead || !headerRow) return;

    discoverOptionalColumns(thead, headerIndex);
    ensureHeaders(thead, headerRow);

    const rows = table.querySelectorAll('tbody > tr');
    rows.forEach((row) => {
      if (row.classList.contains('total') || row.querySelector('th')) {
        ensureRowCells(row).forEach((c) => (c.textContent = ''));
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
      try { return new URL(url).pathname.includes('/positions'); }
      catch { return false; }
    },
    activate(ctx) {
      cancelled = false;
      ctx.log('charges-column activated');

      // Start observer immediately so open positions render without waiting for storage.
      disconnectObserver = ns.dom.observeDom(() => {
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
