# Kite Charges Viewer

Tiny browser extension that adds **Brokerage**, **STT/CTT**, **Total Charges**, and **Net P&L** (gross P&L − charges) columns to the Positions table on [kite.zerodha.com](https://kite.zerodha.com). All calculations happen locally in the page — no network calls, no analytics.

Works on Chrome (Manifest V3) and Firefox ≥ 115 (including Zen).

## Install (unpacked)

### Chrome / Chromium / Brave / Edge

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** → select this folder.
4. Open `https://kite.zerodha.com/positions` — the three extra columns appear on the right of the table.

### Firefox / Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** → select `manifest.json` in this folder.
3. Open `https://kite.zerodha.com/positions`.

Temporary add-ons are removed when Firefox restarts. For a permanent install you'd need to sign it on `addons.mozilla.org`.

## How to verify it's working

- Navigate to `https://kite.zerodha.com/positions` — four new columns (**Brokerage**, **STT/CTT**, **Total Charges**, **Net P&L**) appear at the right of the positions table.
- **Net P&L** is colour-coded: green if you'd keep money after charges, red if costs eat into the gain.
- Hover any column header for a tooltip.
- Navigate away to `/dashboard` or `/orders` — the extra columns disappear and are not injected elsewhere (feature is page-scoped).

### Closed positions

Once Kite squares off a position, its row shows `Qty 0`, `Avg 0.00`, and only the realised P&L. The net-positions view alone doesn't expose buy/sell prices for closed rows, so the extension **remembers the buy_avg and qty while the position is open** (persisted to `chrome.storage.local`, keyed by exchange + tradingsymbol + product, 24h TTL). When the row later flips to closed, the extension reconstructs the sell side from the stored buy data plus the row's visible P&L, and charges + Net P&L stay populated.

That means: if the extension was running while you opened the trade, charges show up for both open and closed rows. If you install the extension *after* closing (or clear browser storage mid-day), closed-row values will fall back to `—`.
- Open DevTools console and run `localStorage.kiteExtDebug = '1'`, reload. You'll see `[KiteExt] charges-column activated` only when on `/positions`.
- Cross-check any row against Zerodha's own [brokerage calculator](https://zerodha.com/brokerage-calculator/). Values should match within ₹1 (STT and stamp duty are rounded to the nearest rupee per Zerodha convention).

## Architecture (for future extension)

```
src/
├── content.js                    # loader — watches URL, (de)activates features
├── registry.js                   # init feature array
├── lib/                          # shared utilities used by any feature
│   ├── charges.js                # RATES + calculateCharges() pure function
│   ├── dom.js                    # table finder, MutationObserver helper
│   ├── format.js                 # Indian currency formatting
│   └── storage.js                # chrome.storage.local wrapper (24h TTL)
└── features/
    └── charges-column/           # this is one feature; drop another folder next to it
        ├── index.js              # exports { id, match(url), activate, deactivate }
        └── styles.css
```

Each feature declares a `match(url)` predicate. The loader **only activates a feature on pages whose URL matches** — features never run on URLs they didn't opt into. To add a new feature:

1. Create `src/features/<name>/index.js` following the shape of `charges-column`.
2. Add its JS (and any CSS) to `manifest.json` under `content_scripts`.

No changes to the loader or other features are needed.

## Updating the rates

Rates live in a single `RATES` object at the top of `src/lib/charges.js` with a `LAST_VERIFIED` date. Zerodha occasionally changes these — when they do, just edit that object and bump `LAST_VERIFIED`. Source of truth: <https://zerodha.com/charges/>.

## Disclaimer

The values shown are **estimates** computed from the row's own quantity and prices (Avg. + LTP). Actual charges appear on the contract note and may differ slightly due to:

- Rounding rules applied by exchanges/depositories.
- DP charges aggregated across the day.
- Rate changes not yet reflected in `RATES`.
- Exercise/assignment on options (we don't model this).

Treat the figures as a quick sanity check, not a statement of account. For open positions, the "sell" side uses the current LTP as a hypothetical close price.

## Permissions

The manifest requests:

- `activeTab` — standard Chrome extension permission.
- `storage` — `chrome.storage.local` only, used to remember open-position buy_avg/qty so closed rows can still compute charges. Data never leaves the browser.
- `host_permissions: https://kite.zerodha.com/*` — the only site the content script is injected on.

No background service worker, no external hosts. A grep for `fetch|XMLHttpRequest|chrome.runtime.send|navigator.sendBeacon` returns zero hits — the extension cannot exfiltrate anything.

To wipe stored positions, open DevTools on kite.zerodha.com and run:
```js
chrome.storage.local.get(null, (all) => chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('kiteExt:'))))
```
