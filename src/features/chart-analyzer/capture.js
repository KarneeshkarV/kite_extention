(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  function requestFullTabScreenshot() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!resp || !resp.ok) return reject(new Error(resp?.error || 'Screenshot failed'));
          resolve(resp.dataUrl);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode screenshot'));
      img.src = src;
    });
  }

  // Capture the given element as a PNG data URL by screenshotting the whole
  // visible tab and cropping to the element's bounding rect. Works with both
  // ChartIQ and TradingView canvases (we never touch their canvas contents).
  async function captureElement(el) {
    if (!el || !el.getBoundingClientRect) throw new Error('captureElement: bad element');
    // Make sure it's visible before we screenshot.
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    // Give the browser a paint frame to settle any scroll.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      throw new Error('Chart element has zero size');
    }

    // Hide our own injected UI while the screenshot is taken so the Analyze
    // button / any leftover overlay doesn't end up in the captured image.
    const hidden = document.querySelectorAll('.kite-ext-ca-btn, .kite-ext-ca-drawer, .kite-ext-ca-modal-backdrop');
    const prev = [];
    hidden.forEach((n) => { prev.push([n, n.style.visibility]); n.style.visibility = 'hidden'; });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let fullDataUrl;
    try {
      fullDataUrl = await requestFullTabScreenshot();
    } finally {
      prev.forEach(([n, v]) => { n.style.visibility = v; });
    }
    const img = await loadImage(fullDataUrl);

    // captureVisibleTab returns an image at device pixels; scale factor
    // between DOM CSS pixels and the screenshot bitmap:
    const scaleX = img.naturalWidth / window.innerWidth;
    const scaleY = img.naturalHeight / window.innerHeight;

    // Clamp crop to viewport so off-screen charts don't bleed.
    const sx = Math.max(0, rect.left) * scaleX;
    const sy = Math.max(0, rect.top) * scaleY;
    const sw = Math.min(window.innerWidth, rect.right) * scaleX - sx;
    const sh = Math.min(window.innerHeight, rect.bottom) * scaleY - sy;

    if (sw < 10 || sh < 10) throw new Error('Chart is off-screen');

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  ns.chartAnalyzer.captureElement = captureElement;
})();
