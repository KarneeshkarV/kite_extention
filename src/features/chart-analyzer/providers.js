(function () {
  'use strict';

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.chartAnalyzer = ns.chartAnalyzer || {};

  ns.chartAnalyzer.providers = [
    { id: 'claude',  label: 'Claude',  model: 'claude-sonnet-4-5' },
    { id: 'gemini',  label: 'Gemini',  model: 'gemini-3-pro', fallbackModels: ['gemini-3-flash-thinking'] },
    { id: 'chatgpt', label: 'ChatGPT', model: 'gpt-5.4',      fallbackModels: ['gpt-5'] },
    { id: 'grok',    label: 'Grok',    model: 'grok-4' },
  ];

  ns.chartAnalyzer.endpoint = 'http://localhost:8000/v1/chat/completions';

  // Bearer token sent in Authorization header. chat_to_llm accepts:
  //   'browser'              → uses the default browser profile
  //   'browser:Profile 1'    → specific Brave/Chrome profile
  //   'browser-auth' / 'browser-cookies' are also valid aliases
  ns.chartAnalyzer.authToken = 'browser';
})();
