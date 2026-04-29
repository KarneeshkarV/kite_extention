(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  const ANALYSIS_PROMPT = [
    'You are a disciplined technical analyst reviewing a stock/F&O chart from Zerodha Kite.',
    'This is for learning and paper-trading style education only. Do not present the result as personalized financial advice or a guaranteed instruction to trade.',
    'Analyze only what is visible on the chart. Focus on market structure, price action, trend, momentum, volatility, candle behavior, and any visible indicators.',
    'Use web search when the backend makes it available, especially for recent ticker-specific market news or events. Keep the visible chart as the primary evidence, and mention when web context materially changes the call.',
    'If volume bars/pane are visible, you must use volume to improve the judgment: check whether breakouts, breakdowns, reversals, and trend continuation are confirmed or weakened by volume expansion, contraction, or divergence.',
    'Prioritize high-probability nearby support/resistance levels that are actually visible. Do not invent levels or certainty when the image is unclear.',
    'Estimate stop_loss and target from the visible chart levels and current/last traded price if readable. For a sell call, stop_loss should normally be above the current/entry area and target below it. For a buy/bullish call, stop_loss should normally be below the current/entry area and target above it.',
    '',
    'Respond with a single JSON object and nothing else. Schema:',
    '{',
    '  "trend": "uptrend" | "downtrend" | "sideways",',
    '  "support": [number, ...],       // up to 3 levels, most important first',
    '  "resistance": [number, ...],    // up to 3 levels, most important first',
    '  "range_low": number,            // suggested buy-zone low',
    '  "range_high": number,           // suggested sell-zone high',
    '  "bias": "bullish" | "bearish" | "neutral",',
    '  "call": "buy" | "sell" | "bullish" | "neutral",',
    '  "stop_loss": number,            // educational estimate, not a trading instruction',
    '  "target": number,               // educational estimate, not a trading instruction',
    '  "web_sources": [{"title": string, "url": string}, ...],',
    '  "notes": "2-4 short sentences summarizing rationale, including the role of volume when visible"',
    '}',
    '',
    'Use null for any numeric field you cannot reliably read from the image. Use an empty array for web_sources when web search is unavailable or irrelevant. Do not wrap the JSON in markdown fences.',
  ].join('\n');

  const CLAUDE_ANALYSIS_PROMPT = [
    'You are performing visual chart classification on a stock/F&O chart image from Zerodha Kite.',
    'This is for learning and paper-trading style education only. Do not present the result as personalized financial advice or a guaranteed instruction to trade.',
    'Analyze the visible chart structure first. Use web search when the backend makes it available, especially for recent ticker-specific market news or events, but do not let web context override clear visible chart evidence.',
    'Identify whether the visible chart looks bullish, bearish, or neutral, estimate an educational buy/sell/bullish/neutral call, and briefly explain the visible reasons using price action, momentum, candle behavior, volatility, and volume if volume is visible.',
    'If the image is unclear or mixed, return neutral and say why. Do not invent off-screen context.',
    'Estimate stop_loss and target only when readable nearby levels support them; otherwise return null.',
    '',
    'Respond with a single JSON object and nothing else. Schema:',
    '{',
    '  "trend": "uptrend" | "downtrend" | "sideways",',
    '  "support": [number, ...],',
    '  "resistance": [number, ...],',
    '  "range_low": number,',
    '  "range_high": number,',
    '  "bias": "bullish" | "bearish" | "neutral",',
    '  "call": "buy" | "sell" | "bullish" | "neutral",',
    '  "stop_loss": number,',
    '  "target": number,',
    '  "web_sources": [{"title": string, "url": string}, ...],',
    '  "notes": "2-4 short sentences describing only visible chart evidence, including volume when visible"',
    '}',
    '',
    'Use null for any numeric field you cannot reliably read from the image. Use an empty array for web_sources when web search is unavailable or irrelevant. Do not wrap the JSON in markdown fences.',
  ].join('\n');

  function buildPrompt(chartContext, provider) {
    const prompt = provider?.id === 'claude' ? CLAUDE_ANALYSIS_PROMPT : ANALYSIS_PROMPT;
    const lines = prompt.split('\n');
    if (!chartContext) return lines.join('\n');

    const extra = [];
    if (chartContext.ticker) extra.push(`Ticker: ${chartContext.ticker}`);
    if (chartContext.range) extra.push(`Chart range: ${chartContext.range}`);
    if (chartContext.interval) extra.push(`Candle interval: ${chartContext.interval}`);
    if (!extra.length) return lines.join('\n');

    lines.push('');
    lines.push('Additional chart context extracted from the page chrome:');
    extra.forEach((line) => lines.push(line));
    lines.push('Use this as supporting context, but prefer the image if there is any conflict.');
    return lines.join('\n');
  }

  function backendFetch({ url, method, headers, body, signal, id }) {
    return new Promise((resolve, reject) => {
      let onAbort;
      if (signal) {
        if (signal.aborted) {
          const e = new Error('Aborted'); e.name = 'AbortError';
          return reject(e);
        }
        onAbort = () => {
          try { chrome.runtime.sendMessage({ type: 'BACKEND_FETCH_ABORT', id }); } catch (_) {}
        };
        signal.addEventListener('abort', onAbort);
      }
      try {
        chrome.runtime.sendMessage(
          { type: 'BACKEND_FETCH', id, url, method, headers, body },
          (resp) => {
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            const lastErr = chrome.runtime.lastError;
            if (lastErr) return reject(new Error(lastErr.message));
            if (!resp) return reject(new Error('No response from background'));
            if (resp.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; return reject(e); }
            if (!resp.ok) return reject(new Error(resp.error || 'Background fetch failed'));
            resolve(resp);
          }
        );
      } catch (e) {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    });
  }

  async function callOnce({ dataUrl, model, signal, chartContext, provider }) {
    const endpoint = ns.chartAnalyzer.endpoint;
    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(chartContext, provider) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
    };

    const reqId = `ca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resp = await backendFetch({
      id: reqId,
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ns.chartAnalyzer.authToken || 'browser'}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (resp.status < 200 || resp.status >= 300) {
      const text = resp.body || '';
      const err = new Error(`Backend ${resp.status}: ${text.slice(0, 1200) || resp.statusText}`);
      err.status = resp.status;
      err.body = text;
      throw err;
    }

    let json;
    try { json = JSON.parse(resp.body); }
    catch (e) { throw new Error(`Invalid JSON from backend: ${e.message}`); }
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

  async function analyzeChart({ dataUrl, provider, signal, chartContext }) {
    const models = [provider.model, ...(provider.fallbackModels || [])];
    let lastErr;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        const result = await callOnce({ dataUrl, model, signal, chartContext, provider });
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
