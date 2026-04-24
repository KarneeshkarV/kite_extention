(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  const ANALYSIS_PROMPT = [
    'You are a seasoned technical analyst. The attached image is a stock/F&O chart from Zerodha Kite.',
    'Analyze price action, trend, momentum, and any visible indicators.',
    '',
    'Respond with a single JSON object and nothing else. Schema:',
    '{',
    '  "trend": "uptrend" | "downtrend" | "sideways",',
    '  "support": [number, ...],       // up to 3 levels, most important first',
    '  "resistance": [number, ...],    // up to 3 levels, most important first',
    '  "range_low": number,            // suggested buy-zone low',
    '  "range_high": number,           // suggested sell-zone high',
    '  "bias": "bullish" | "bearish" | "neutral",',
    '  "notes": "2-4 short sentences summarizing rationale"',
    '}',
    '',
    'If you cannot read a price from the image, use null for that field. Do not wrap the JSON in markdown fences.',
  ].join('\n');

  async function callOnce({ dataUrl, model, signal }) {
    const endpoint = ns.chartAnalyzer.endpoint;
    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ANALYSIS_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ns.chartAnalyzer.authToken || 'browser'}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Backend ${res.status}: ${text.slice(0, 1200) || res.statusText}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    return { text: typeof text === 'string' ? text : JSON.stringify(text), raw: json };
  }

  // Heuristic: does this error look like "model not found / unsupported"?
  // chat_to_llm surfaces these as 4xx with a message mentioning the model.
  function isModelError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return false;
    if (err.status && err.status >= 400 && err.status < 500) return true;
    const msg = (err.body || err.message || '').toLowerCase();
    return msg.includes('model') && (msg.includes('not') || msg.includes('unknown') || msg.includes('unsupported'));
  }

  async function analyzeChart({ dataUrl, provider, signal }) {
    const models = [provider.model, ...(provider.fallbackModels || [])];
    let lastErr;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const result = await callOnce({ dataUrl, model, signal });
        return { ...result, modelUsed: model };
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') throw err;
        // Only fall back on model-related failures; surface network / server errors immediately.
        if (i < models.length - 1 && isModelError(err)) {
          console.warn('[KiteExt:chart-analyzer] model', model, 'failed, falling back to', models[i + 1], '—', err.message);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  // Try to extract the JSON object from a model response. Returns null on failure.
  function parseAnalysis(text) {
    if (!text) return null;
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      // Sometimes models prepend a sentence. Grab the first balanced {...} block.
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) {}
      }
    }
    return null;
  }

  ns.chartAnalyzer.analyzeChart = analyzeChart;
  ns.chartAnalyzer.parseAnalysis = parseAnalysis;
  ns.chartAnalyzer.ANALYSIS_PROMPT = ANALYSIS_PROMPT;
})();
