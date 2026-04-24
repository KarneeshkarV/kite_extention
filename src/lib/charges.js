(function () {
  'use strict';

  // Rates last verified against https://zerodha.com/charges/ on 2026-04-24.
  // All percentages expressed as decimals (0.0003 = 0.03%).
  // SEBI turnover fee is ₹10 per crore = 0.0001% = 0.000001.
  const RATES = {
    EQ_INTRADAY: {
      brokerage: { pct: 0.0003, cap: 20 },       // per leg, min(0.03%, ₹20)
      stt_sell: 0.00025,                          // 0.025% on sell value
      exch: { NSE: 0.0000307, BSE: 0.0000375 },   // on turnover
      sebi: 0.000001,
      stamp_buy: 0.00003,                         // 0.003% on buy value
      gst: 0.18,
    },
    EQ_DELIVERY: {
      brokerage: 0,
      stt_both: 0.001,                            // 0.1% on buy + sell
      exch: { NSE: 0.0000307, BSE: 0.0000375 },
      sebi: 0.000001,
      stamp_buy: 0.00015,                         // 0.015% on buy
      dp_sell: 15.34,                             // flat per scrip on sell
      gst: 0.18,
    },
    EQ_FUT: {
      brokerage: { pct: 0.0003, cap: 20 },
      stt_sell: 0.0005,                           // 0.05% on sell value (non-exercised)
      exch_pct: 0.0000183,                        // 0.00183% NSE; BSE currently 0%
      sebi: 0.000001,
      stamp_buy: 0.00002,
      gst: 0.18,
    },
    EQ_OPT: {
      brokerage_flat: 20,                         // per leg
      stt_sell_premium: 0.0015,                   // 0.15% on sell premium
      exch: { NSE: 0.0003553, BSE: 0.000325 },    // on premium turnover
      sebi: 0.000001,
      stamp_buy_premium: 0.00003,
      gst: 0.18,
    },
    CUR_FUT: {
      brokerage: { pct: 0.0003, cap: 20 },
      exch_pct: 0.0000035,                        // 0.00035% NSE
      sebi: 0.000001,
      stamp_buy: 0.000001,                        // 0.0001%
      gst: 0.18,
    },
    CUR_OPT: {
      brokerage_flat: 20,
      exch_pct: 0.000311,                         // 0.0311% NSE on premium
      sebi: 0.000001,
      stamp_buy_premium: 0.000001,
      gst: 0.18,
    },
    COMM_FUT: {
      brokerage: { pct: 0.0003, cap: 20 },
      ctt_sell: 0.0001,                           // 0.01% non-agri on sell
      exch_pct: 0.000021,                         // 0.0021% MCX
      sebi: 0.000001,
      stamp_buy: 0.00002,
      gst: 0.18,
    },
    COMM_OPT: {
      brokerage_flat: 20,
      ctt_sell_premium: 0.0005,                   // 0.05% on sell premium
      exch_pct: 0.000418,                         // 0.0418% MCX on premium
      sebi: 0.000001,
      stamp_buy_premium: 0.00003,
      gst: 0.18,
    },
  };

  function detectSegment({ exchange, tradingsymbol, product }) {
    const ex = (exchange || '').toUpperCase();
    const sym = (tradingsymbol || '').toUpperCase();
    const prod = (product || '').toUpperCase();
    const isOpt = /(CE|PE)$/.test(sym);
    const isFut = /FUT$/.test(sym) || sym.includes('FUT');

    if (ex === 'NSE' || ex === 'BSE') {
      if (prod === 'MIS') return 'EQ_INTRADAY';
      return 'EQ_DELIVERY'; // CNC or anything else on equity segment
    }
    if (ex === 'NFO' || ex === 'BFO') return isOpt ? 'EQ_OPT' : 'EQ_FUT';
    if (ex === 'CDS' || ex === 'BCD') return isOpt ? 'CUR_OPT' : 'CUR_FUT';
    if (ex === 'MCX') return isOpt ? 'COMM_OPT' : 'COMM_FUT';
    return 'EQ_INTRADAY'; // safest default
  }

  const perLegCapped = (value, cfg) => Math.min(value * cfg.pct, cfg.cap);
  const roundRupee = (n) => Math.round(n);

  // position: { exchange, tradingsymbol, product, qty, buy_avg, sell_avg, ltp }
  // qty > 0: long (sell_avg is the close price if set, else ltp)
  // qty < 0: short (buy price is buy_avg if set, else ltp)
  // For simplicity we treat the row as one round-trip: buy_value uses buy_avg*|qty|,
  // sell_value uses (sell_avg || ltp)*|qty|.
  function calculateCharges(position) {
    const segment = detectSegment(position);
    const qty = Math.abs(Number(position.qty) || 0);
    const buyPrice = Number(position.buy_avg) || 0;
    const sellPrice = Number(position.sell_avg) || Number(position.ltp) || 0;
    if (!qty || !buyPrice || !sellPrice) {
      return { segment, brokerage: NaN, stt: NaN, exchange: NaN, sebi: NaN, stamp: NaN, gst: NaN, dp: 0, total: NaN };
    }

    const buyValue = buyPrice * qty;
    const sellValue = sellPrice * qty;
    const turnover = buyValue + sellValue;
    const ex = (position.exchange || '').toUpperCase();
    const r = RATES[segment];

    let brokerage = 0, stt = 0, exch = 0, sebi = 0, stamp = 0, dp = 0;

    switch (segment) {
      case 'EQ_INTRADAY': {
        brokerage = perLegCapped(buyValue, r.brokerage) + perLegCapped(sellValue, r.brokerage);
        stt = roundRupee(sellValue * r.stt_sell);
        exch = turnover * (r.exch[ex] ?? r.exch.NSE);
        sebi = turnover * r.sebi;
        stamp = roundRupee(buyValue * r.stamp_buy);
        break;
      }
      case 'EQ_DELIVERY': {
        brokerage = 0;
        stt = roundRupee(turnover * r.stt_both);
        exch = turnover * (r.exch[ex] ?? r.exch.NSE);
        sebi = turnover * r.sebi;
        stamp = roundRupee(buyValue * r.stamp_buy);
        dp = r.dp_sell;
        break;
      }
      case 'EQ_FUT': {
        brokerage = perLegCapped(buyValue, r.brokerage) + perLegCapped(sellValue, r.brokerage);
        stt = sellValue * r.stt_sell;
        exch = turnover * r.exch_pct;
        sebi = turnover * r.sebi;
        stamp = roundRupee(buyValue * r.stamp_buy);
        break;
      }
      case 'EQ_OPT': {
        brokerage = r.brokerage_flat * 2;
        stt = sellValue * r.stt_sell_premium;
        exch = turnover * (r.exch[ex] ?? r.exch.NSE);
        sebi = turnover * r.sebi;
        stamp = buyValue * r.stamp_buy_premium;
        break;
      }
      case 'CUR_FUT': {
        brokerage = perLegCapped(buyValue, r.brokerage) + perLegCapped(sellValue, r.brokerage);
        exch = turnover * r.exch_pct;
        sebi = turnover * r.sebi;
        stamp = buyValue * r.stamp_buy;
        break;
      }
      case 'CUR_OPT': {
        brokerage = r.brokerage_flat * 2;
        exch = turnover * r.exch_pct;
        sebi = turnover * r.sebi;
        stamp = buyValue * r.stamp_buy_premium;
        break;
      }
      case 'COMM_FUT': {
        brokerage = perLegCapped(buyValue, r.brokerage) + perLegCapped(sellValue, r.brokerage);
        stt = sellValue * r.ctt_sell; // CTT reported in the STT column for brevity
        exch = turnover * r.exch_pct;
        sebi = turnover * r.sebi;
        stamp = buyValue * r.stamp_buy;
        break;
      }
      case 'COMM_OPT': {
        brokerage = r.brokerage_flat * 2;
        stt = sellValue * r.ctt_sell_premium;
        exch = turnover * r.exch_pct;
        sebi = turnover * r.sebi;
        stamp = buyValue * r.stamp_buy_premium;
        break;
      }
    }

    const gst = (brokerage + exch + sebi) * r.gst;
    const total = brokerage + stt + exch + sebi + stamp + dp + gst;
    return { segment, brokerage, stt, exchange: exch, sebi, stamp, gst, dp, total };
  }

  const ns = (window.__KiteExt = window.__KiteExt || {});
  ns.charges = { RATES, detectSegment, calculateCharges, LAST_VERIFIED: '2026-04-24' };
})();
