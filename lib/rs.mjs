// lib/rs.mjs — Relative Strength Rating (1–99), O'Neil style. ANALYSIS ONLY.
//
// This is a TRUE percentile, not a proxy: one call to TradingView's scanner (the same
// server-side endpoint lib/tpo.mjs already uses — its `post` is reused directly) returns
// trailing performance for the whole universe, and each symbol is ranked against its OWN
// market. NSE names are ranked against NSE, US names against NASDAQ/NYSE/AMEX — never
// pooled, because cross-market percentiles are meaningless.
//
// Weighting follows IBD's construction, which double-weights the most recent quarter:
//     RS_raw = (2 × Perf.3M + Perf.6M + Perf.Y) / 4
// (IBD also uses a 9-month term; the scanner does not expose one, so the remaining three
// windows carry it. This is documented in the tab rather than hidden.)
//
// LIQUIDITY FLOOR — essential, not cosmetic. Unfiltered, the NSE scan returns illiquid
// microcaps with Perf.Y of ~2,900% that would dominate the top decile and make every
// real name's percentile meaningless. Names must clear both a market-cap and a daily
// turnover floor to enter the ranking universe.

import { post } from './tpo.mjs';
import { getSessionCookie } from './tv.mjs';

const COLS = ['name', 'close', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y',
  'average_volume_10d_calc', 'market_cap_basic'];

const MARKETS = {
  india: { region: 'india', exchanges: ['NSE'], needsAuth: false,
    minCap: 5e9, minTurnover: 5e7, cur: '₹', capLabel: '₹500cr', turnLabel: '₹5cr' },
  usa: { region: 'america', exchanges: ['NASDAQ', 'NYSE', 'AMEX'], needsAuth: true,
    minCap: 3e8, minTurnover: 5e6, cur: '$', capLabel: '$300M', turnLabel: '$5M' },
};

const CACHE_MS = 15 * 60 * 1000;
const _cache = {};        // marketKey -> { ts, table }

// Build (or reuse) the ranked table for one market.
export async function rsTable(marketKey = 'india') {
  const m = MARKETS[marketKey];
  if (!m) throw new Error(`unknown market: ${marketKey}`);
  const hit = _cache[marketKey];
  if (hit && Date.now() - hit.ts < CACHE_MS) return { ...hit.table, cached: true };

  const cookie = m.needsAuth ? await getSessionCookie() : '';
  const body = {
    filter: [
      { left: 'exchange', operation: 'in_range', right: m.exchanges },
      { left: 'is_primary', operation: 'equal', right: true },
      { left: 'type', operation: 'equal', right: 'stock' },
    ],
    options: { lang: 'en' }, columns: COLS,
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, 10000],
  };
  const j = await post(m.region, body, cookie);
  const raw = (j.data || []).map(row => {
    const o = {}; COLS.forEach((c, i) => { o[c] = row.d[i]; });
    o.ticker = row.s;
    return o;
  });

  // Liquidity gate, then rank what survives.
  const pool = [];
  for (const r of raw) {
    const cap = r.market_cap_basic, vol = r.average_volume_10d_calc, px = r.close;
    if (!(cap >= m.minCap) || !(vol > 0) || !(px > 0)) continue;
    if (!(vol * px >= m.minTurnover)) continue;
    const p3 = r['Perf.3M'], p6 = r['Perf.6M'], p12 = r['Perf.Y'];
    if (![p3, p6, p12].every(v => typeof v === 'number' && isFinite(v))) continue;
    pool.push({ name: r.name, ticker: r.ticker, raw: (2 * p3 + p6 + p12) / 4, p1: r['Perf.1M'], p3, p6, p12 });
  }
  pool.sort((a, b) => a.raw - b.raw);                 // weakest first
  const n = pool.length;
  const ranks = new Map();
  pool.forEach((x, i) => {
    // Percentile 1–99: the fraction of the universe this name outperforms.
    const rs = n > 1 ? Math.max(1, Math.min(99, Math.round(1 + 98 * (i / (n - 1))))) : 50;
    ranks.set(x.name.toUpperCase(), { rs, raw: x.raw, p1: x.p1, p3: x.p3, p6: x.p6, p12: x.p12 });
  });

  const table = {
    ok: true, ts: Date.now(), market: marketKey, universe: raw.length, ranked: n, ranks,
    filter: `market cap ≥ ${m.capLabel} and 10-day turnover ≥ ${m.turnLabel}`,
    method: 'RS_raw = (2×Perf.3M + Perf.6M + Perf.1Y) / 4, percentile-ranked 1–99 within the same market',
  };
  _cache[marketKey] = { ts: Date.now(), table };
  return table;
}

// RS Rating for one symbol. Returns { ok, rs, … } or { ok:false, reason } — never throws.
export async function rsFor(symbol, marketKey) {
  const name = String(symbol || '').split(':').pop().trim().toUpperCase();
  try {
    const t = await rsTable(marketKey);
    const hit = t.ranks.get(name);
    if (!hit) {
      return { ok: false, reason: 'not_ranked', universe: t.ranked, filter: t.filter,
        error: `${name} is outside the ranking universe (${t.filter}) — RS Rating needs a liquid, institutionally tradable name.` };
    }
    return { ok: true, ...hit, universe: t.ranked, asOf: t.ts, method: t.method, filter: t.filter, cached: t.cached || false };
  } catch (e) {
    return { ok: false, reason: 'network', error: `RS universe scan failed: ${e.message}` };
  }
}

export { MARKETS as RS_MARKETS };
