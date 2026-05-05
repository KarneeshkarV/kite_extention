(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  const REQUIRED_HEADERS = ['symbol', 'current value', 'total invested', 'average cost', 'qty'];
  const NEW_HEADERS = [
    {
      key: 'fees',
      label: 'Fees',
      title: 'Estimated Vested Basic buy + hypothetical sell brokerage. Pre-tax estimate.',
    },
    {
      key: 'netpnl',
      label: 'Net P&L',
      title: 'Overall return minus estimated Vested fees. Income tax is not included.',
    },
    {
      key: 'netpct',
      label: 'Net %',
      title: 'Net P&L divided by total invested. Income tax is not included.',
    },
  ];

  let disconnectObserver = null;
  let latestPortfolioEstimate = null;

  function ensureHeaders(thead, headerRow) {
    const existing = thead.querySelectorAll('th.kite-ext-vested-col');
    if (existing.length === NEW_HEADERS.length) return;
    existing.forEach((n) => n.remove());
    for (const h of NEW_HEADERS) {
      const th = document.createElement('th');
      th.className = 'kite-ext-col kite-ext-vested-col kite-ext-vested-compact kite-ext-vested-col-' + h.key;
      th.dataset.key = h.key;
      th.textContent = h.label;
      th.title = h.title;
      headerRow.appendChild(th);
    }
  }

  function ensureRowCells(row) {
    const existing = row.querySelectorAll('td.kite-ext-vested-cell');
    const existingKeys = Array.from(existing).map((td) => td.dataset.key || '');
    const desiredKeys = NEW_HEADERS.map((h) => h.key);
    const matches = existing.length === NEW_HEADERS.length &&
      existingKeys.every((k, i) => k === desiredKeys[i]);
    if (matches) return Array.from(existing);

    existing.forEach((n) => n.remove());
    const cells = [];
    for (const h of NEW_HEADERS) {
      const td = document.createElement('td');
      td.className = 'kite-ext-cell kite-ext-est kite-ext-vested-cell kite-ext-vested-compact kite-ext-vested-cell-' + h.key;
      td.dataset.key = h.key;
      row.appendChild(td);
      cells.push(td);
    }
    return cells;
  }

  function extractRowData(row, headerIndex) {
    const cells = row.querySelectorAll('td');
    const symbolCell = cells[headerIndex.symbol];
    if (!symbolCell) return null;
    const symbolText = (symbolCell.textContent || '').trim();
    const symbol = (symbolText.match(/[A-Z][A-Z0-9.-]{0,9}/) || [''])[0];
    return {
      symbol,
      current_value: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'current value')),
      total_invested: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'total invested')),
      average_cost: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'average cost')),
      qty: ns.format.parseNumeric(ns.dom.readCell(row, headerIndex, 'qty')),
    };
  }

  function computeForRow(data) {
    if (!data || !data.symbol || !(data.current_value > 0) || !(data.total_invested > 0)) return null;
    const charges = ns.charges.calculateVestedCharges(data, { tier: 'BASIC' });
    const grossPnl = data.current_value - data.total_invested;
    const netPnl = Number.isFinite(charges.total) ? grossPnl - charges.total : NaN;
    const netPct = Number.isFinite(netPnl) ? (netPnl / data.total_invested) * 100 : NaN;
    return { charges, netPnl, netPct };
  }

  function computePortfolioEstimate(table, headerIndex) {
    const maxIdx = Math.max(...REQUIRED_HEADERS.map((key) => headerIndex[key] ?? -1));
    let currentValue = 0;
    let totalInvested = 0;
    let fees = 0;
    let count = 0;

    table.querySelectorAll('tbody > tr').forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length <= maxIdx) return;
      const data = extractRowData(row, headerIndex);
      const result = computeForRow(data);
      if (!result) return;
      currentValue += data.current_value;
      totalInvested += data.total_invested;
      fees += result.charges.total;
      count += 1;
    });

    if (!count || !(totalInvested > 0)) return null;
    const grossPnl = currentValue - totalInvested;
    const netPnl = grossPnl - fees;
    return {
      fees,
      netPnl,
      netPct: (netPnl / totalInvested) * 100,
      source: 'rows',
    };
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

    byKey.fees.textContent = ns.format.usd(result.charges.total);
    byKey.netpnl.textContent = ns.format.usd(result.netPnl);
    byKey.netpct.textContent = ns.format.pct(result.netPct);
    [byKey.netpnl, byKey.netpct].forEach((cell) => {
      cell.classList.toggle('kite-ext-pos', Number.isFinite(result.netPnl) && result.netPnl > 0);
      cell.classList.toggle('kite-ext-neg', Number.isFinite(result.netPnl) && result.netPnl < 0);
    });
  }

  function renderTable(found) {
    const { table, headerIndex } = found;
    const thead = table.querySelector('thead');
    const headerRow = thead && thead.querySelector('tr');
    if (!thead || !headerRow) return;

    table.classList.add('kite-ext-vested-table');
    const scrollHost = table.parentElement;
    if (scrollHost) scrollHost.classList.add('kite-ext-vested-scroll');

    ensureHeaders(thead, headerRow);
    const maxIdx = Math.max(...REQUIRED_HEADERS.map((key) => headerIndex[key] ?? -1));
    table.querySelectorAll('tbody > tr').forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length <= maxIdx) {
        row.querySelectorAll('td.kite-ext-vested-cell').forEach((n) => n.remove());
        return;
      }
      const injectedCells = ensureRowCells(row);
      writeCells(injectedCells, computeForRow(extractRowData(row, headerIndex)));
    });
    latestPortfolioEstimate = computePortfolioEstimate(table, headerIndex);
  }

  function findPortfolioMetricHost() {
    const candidates = Array.from(document.querySelectorAll('div, section, article'));
    return candidates.find((el) => {
      if (el.querySelector('.kite-ext-vested-summary-net')) return true;
      const text = ns.dom.norm(el.textContent);
      return text.includes('unrealized p&l') && text.includes('xirr');
    }) || null;
  }

  function findXirrLine(host) {
    const nodes = Array.from(host.querySelectorAll('div, p, span'));
    return nodes.find((el) => {
      if (el.classList.contains('kite-ext-vested-summary-net')) return false;
      return ns.dom.norm(el.textContent).startsWith('xirr');
    }) || null;
  }

  function renderPortfolioSummary() {
    if (!latestPortfolioEstimate) return;
    const host = findPortfolioMetricHost();
    if (!host) return;

    let row = host.querySelector('.kite-ext-vested-summary-net');
    if (!row) {
      const xirrLine = findXirrLine(host);
      if (!xirrLine || !xirrLine.parentElement) return;
      row = document.createElement('div');
      row.className = 'kite-ext-vested-summary-net';
      row.title = 'Estimated Vested Basic buy + hypothetical sell brokerage deducted. Income tax is not included.';
      xirrLine.parentElement.insertBefore(row, xirrLine.nextSibling);
    }

    row.classList.toggle('kite-ext-pos', latestPortfolioEstimate.netPnl > 0);
    row.classList.toggle('kite-ext-neg', latestPortfolioEstimate.netPnl < 0);
    row.innerHTML = '<span>Net P&amp;L:</span> ' +
      `<strong>${ns.format.usd(latestPortfolioEstimate.netPnl)} (${ns.format.pct(latestPortfolioEstimate.netPct)})</strong>` +
      ` <small>after ${ns.format.usd(latestPortfolioEstimate.fees)} fees</small>`;
  }

  function removeInjections() {
    document.querySelectorAll('.kite-ext-vested-col, .kite-ext-vested-cell, .kite-ext-vested-summary-net').forEach((n) => n.remove());
  }

  const feature = {
    id: 'vested-charges',
    match: (url) => {
      try {
        const u = new URL(url);
        return /(^|\.)vestedfinance\.com$/i.test(u.hostname);
      } catch { return false; }
    },
    activate(ctx) {
      ctx.log('vested-charges activated');
      disconnectObserver = ns.dom.observeDom(() => {
        const found = ns.dom.findTableByHeaders(REQUIRED_HEADERS);
        if (found) renderTable(found);
        renderPortfolioSummary();
      }, 250);
    },
    deactivate() {
      if (disconnectObserver) { disconnectObserver(); disconnectObserver = null; }
      removeInjections();
    },
  };

  ns.features = ns.features || [];
  ns.features.push(feature);
})();
