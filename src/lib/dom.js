(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Given a set of header fragments (lowercased), find the first <table>
  // whose <th> texts cover all of them. Returns { table, headerIndex } or null.
  function findTableByHeaders(required) {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const ths = table.querySelectorAll('thead th');
      if (!ths.length) continue;
      const headers = Array.from(ths).map((th) => norm(th.textContent));
      const index = {};
      for (const key of required) {
        const i = headers.findIndex((h) => h.includes(key));
        if (i === -1) {
          index.__missing = true;
          break;
        }
        index[key] = i;
      }
      if (!index.__missing) return { table, headerIndex: index };
    }
    return null;
  }

  // Read a cell's numeric value by header key, using the headerIndex map.
  function readCell(row, headerIndex, key) {
    const cells = row.querySelectorAll('td');
    const i = headerIndex[key];
    if (i == null || !cells[i]) return '';
    return cells[i].textContent || '';
  }

  // Debounced MutationObserver over <body>. Calls onMutate() at most every
  // `wait` ms while DOM churn continues. Returns a disconnect fn.
  function observeDom(onMutate, wait = 200) {
    let timer = null;
    const fire = () => {
      timer = null;
      try { onMutate(); } catch (e) { console.error('[KiteExt] observer cb error', e); }
    };
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(fire, wait);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Kick once to handle the case where the table is already mounted.
    fire();
    return () => {
      if (timer) clearTimeout(timer);
      mo.disconnect();
    };
  }

  ns.dom = { findTableByHeaders, readCell, observeDom, norm };
})();
