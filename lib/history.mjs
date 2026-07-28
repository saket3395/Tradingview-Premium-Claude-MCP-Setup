// lib/history.mjs — multi-timeframe OHLC history for the Pattern Analysis tab.
// ANALYSIS ONLY. Zero dependencies (Node built-in fetch), no chart interaction.
//
// Two real providers, chosen by symbol prefix — nothing is ever synthesised:
//   India (NSE:…)  → Upstox historical-candle (same token the TPO Confirm step uses).
//                    day / week / month are native; 4H is aggregated from 30-minute
//                    candles anchored to the NSE session open (09:15 IST), which is how
//                    TradingView buckets 4H on NSE: 09:15–13:15 and 13:15–15:30.
//   USA (default)  → Alpaca market data v2 (4Hour / 1Day / 1Week / 1Month native).
//                    Free IEX feed by default; set ALPACA_FEED=sip if entitled.
//
// Any missing credential / network failure returns { ok:false, error } for that
// timeframe — the analyzer then reports the timeframe as unavailable rather than
// guessing, matching the repo's "never fabricate data" stance (see lib/backtest.mjs).

import { readFileSync, existsSync } from 'node:fs';
import { instrumentKeyFor } from './upstox.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TFS = ['4H', '1D', '1W', '1M'];

// Symbol-level cache. History moves slowly; 5 min keeps the tab snappy and polite.
const CACHE_MS = 5 * 60 * 1000;
const _cache = new Map();   // key -> { ts, data }

export const isIndia = symbol => /^(NSE|BSE)[:_]/i.test(String(symbol || ''));
export const bareSymbol = s => String(s || '').split(':').pop().trim().toUpperCase().replace(/\s+/g, '');

const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d);
const daysAgo = n => ymd(new Date(Date.now() - n * 86400000));

// ---- India: Upstox ---------------------------------------------------------
function upstoxToken() {
  const file = process.env.UPSTOX_TOKEN_FILE;
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')).access_token || null; } catch { return null; }
}

// Upstox v2 returns newest-first [isoTs, o, h, l, c, v, oi]. Normalised to oldest-first.
async function upstoxCandles(ik, interval, from, to, token) {
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(ik)}/${interval}/${to}/${from}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.errors?.[0]?.message || `Upstox ${interval} HTTP ${res.status}`);
  return (j?.data?.candles || [])
    .map(c => ({ t: Date.parse(c[0]), iso: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] }))
    .sort((a, b) => a.t - b.t);
}

// Today's (still-running) session — the historical endpoint excludes it.
async function upstoxIntraday(ik, interval, token) {
  const res = await fetch(`https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(ik)}/${interval}/`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(12000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return (j?.data?.candles || [])
    .map(c => ({ t: Date.parse(c[0]), iso: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] }))
    .sort((a, b) => a.t - b.t);
}

// NSE 4H = 8 × 30-minute slots from the session open; the day's tail forms a short
// second bar (13:15–15:30), exactly as TradingView prints it.
function to4H(m30) {
  const byDay = new Map();
  for (const b of m30) {
    const day = b.iso.slice(0, 10);                       // IST date (offset is in the string)
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(b);
  }
  const out = [];
  for (const [, bars] of [...byDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    for (let i = 0; i < bars.length; i += 8) {
      const g = bars.slice(i, i + 8);
      out.push({
        t: g[0].t, iso: g[0].iso, o: g[0].o, c: g[g.length - 1].c,
        h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)),
        v: g.reduce((s, x) => s + (x.v || 0), 0),
      });
    }
  }
  return out;
}

async function indiaSeries(symbol) {
  const token = upstoxToken();
  if (!token) return { ok: false, error: 'No Upstox token — set UPSTOX_TOKEN_FILE (analytics token recommended).' };
  const name = bareSymbol(symbol);
  let ik;
  try { ik = await instrumentKeyFor(name); } catch (e) { return { ok: false, error: `instrument map: ${e.message}` }; }
  if (!ik) return { ok: false, error: `No Upstox NSE_EQ instrument for ${name}.` };

  // Ranges sized to what each timeframe's analysis needs, and to Upstox's per-interval
  // range limits (day is capped near a year, month accepts several years).
  // Upstox caps a 30-minute request at ~90 days, and its historical endpoint only serves
  // COMPLETED sessions — today's bars come from the /intraday variant (best-effort).
  const m30 = (async () => {
    const done = await upstoxCandles(ik, '30minute', daysAgo(88), daysAgo(0), token);
    let live = [];
    try { live = await upstoxIntraday(ik, '30minute', token); } catch {}
    const seen = new Set(done.map(b => b.iso));
    return [...done, ...live.filter(b => !seen.has(b.iso))].sort((a, b) => a.t - b.t);
  })();

  const jobs = {
    '4H': m30.then(to4H),
    '1D': upstoxCandles(ik, 'day', daysAgo(360), daysAgo(0), token),
    '1W': upstoxCandles(ik, 'week', daysAgo(1800), daysAgo(0), token),
    '1M': upstoxCandles(ik, 'month', daysAgo(2500), daysAgo(0), token),
  };
  const tfs = {};
  await Promise.all(TFS.map(async tf => {
    try { tfs[tf] = { ok: true, bars: await jobs[tf] }; }
    catch (e) { tfs[tf] = { ok: false, error: e.message, bars: [] }; }
  }));
  return { ok: true, market: 'india', source: 'Upstox historical-candle (4H aggregated from 30m, NSE session-anchored)', tfs };
}

// ---- USA: Alpaca -----------------------------------------------------------
async function alpacaBars(sym, timeframe, start, key, secret, feed) {
  const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(sym)}`
    + `&timeframe=${timeframe}&start=${start}&limit=10000&feed=${feed}&adjustment=all&sort=asc`;
  const res = await fetch(url, {
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.message || `Alpaca ${timeframe} HTTP ${res.status}`);
  const rows = j?.bars?.[sym] || [];
  if (!rows.length) throw new Error(`Alpaca returned no ${timeframe} bars for ${sym}.`);
  return rows.map(b => ({ t: Date.parse(b.t), iso: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

async function usaSeries(symbol) {
  const key = process.env.ALPACA_KEY_ID, secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return { ok: false, error: 'No Alpaca credentials — set ALPACA_KEY_ID / ALPACA_SECRET_KEY in .env.' };
  const feed = process.env.ALPACA_FEED || 'iex';
  const sym = bareSymbol(symbol);
  const jobs = {
    '4H': alpacaBars(sym, '4Hour', daysAgo(150), key, secret, feed),
    '1D': alpacaBars(sym, '1Day', daysAgo(400), key, secret, feed),
    '1W': alpacaBars(sym, '1Week', daysAgo(1800), key, secret, feed),
    '1M': alpacaBars(sym, '1Month', daysAgo(3600), key, secret, feed),
  };
  const tfs = {};
  await Promise.all(TFS.map(async tf => {
    try { tfs[tf] = { ok: true, bars: await jobs[tf] }; }
    catch (e) { tfs[tf] = { ok: false, error: e.message, bars: [] }; }
  }));
  return { ok: true, market: 'usa', source: `Alpaca market data v2 (feed=${feed}; 4H bars are UTC-anchored and include extended hours)`, tfs };
}

// ---- public ----------------------------------------------------------------
// Returns { ok, market, symbol, source, asOf, tfs: { '4H'|'1D'|'1W'|'1M': {ok, bars[], error?} } }.
export async function getSeries(symbol) {
  const cacheKey = String(symbol || '').toUpperCase();
  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_MS) return { ...hit.data, cached: true };

  // Routing: an explicit NSE:/BSE: prefix is authoritative. A bare symbol is resolved
  // against the Upstox NSE master first (INFY -> India) and falls back to Alpaca (AAPL).
  let india = isIndia(symbol);
  if (!india && !/:/.test(String(symbol))) {
    try { india = !!(await instrumentKeyFor(bareSymbol(symbol))); } catch { india = false; }
  }
  const out = india ? await indiaSeries(symbol) : await usaSeries(symbol);
  const data = { ...out, symbol: cacheKey, asOf: Date.now() };
  if (out.ok) _cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// ---- symbol search (autocomplete) ------------------------------------------
// TradingView's public symbol-search, filtered to the exchanges this module can
// actually serve history for. Anything else is omitted rather than offered and then
// failing at analysis time. Cached per query; never throws.
const SEARCHABLE = { NSE: 'india', NASDAQ: 'usa', NYSE: 'usa', AMEX: 'usa' };
const _search = new Map();          // q -> { ts, rows }
const SEARCH_TTL = 10 * 60 * 1000;

export async function searchSymbols(q) {
  const key = q.trim().toUpperCase();
  const hit = _search.get(key);
  if (hit && Date.now() - hit.ts < SEARCH_TTL) return { ok: true, q: key, rows: hit.rows, cached: true };
  try {
    const res = await fetch(`https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(key)}&type=stock`, {
      headers: { 'user-agent': UA, origin: 'https://www.tradingview.com', referer: 'https://www.tradingview.com/' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, q: key, rows: [], error: `symbol-search HTTP ${res.status}` };
    const arr = await res.json();
    const seen = new Set(), rows = [];
    for (const r of Array.isArray(arr) ? arr : []) {
      const ex = String(r.exchange || '').toUpperCase();
      const market = SEARCHABLE[ex];
      if (!market) continue;
      const sym = String(r.symbol || '').toUpperCase();
      const id = `${ex}:${sym}`;
      if (!sym || seen.has(id)) continue;
      const desc = String(r.description || '').replace(/<[^>]*>/g, '');
      // TradingView pads the tail of its result list with unrelated names, and US
      // exchanges expose warrant/structured tickers (AAPLWXX, INFYPBX). Keep only rows
      // the query actually explains — ticker prefix or a word in the company name.
      const rel = sym.startsWith(key) ? 0
        : new RegExp(`\\b${key.replace(/[^A-Z0-9]/g, '')}`, 'i').test(desc) ? 1 : -1;
      if (rel < 0) continue;
      // US warrants / structured notes (AAPLWXX, INFYPBX, AAGDXXX) are tradable tickers
      // but not the common-stock listing anyone means here, and they swamp the list.
      if (market === 'usa' && sym.length >= 5 && /X$/.test(sym)) continue;
      seen.add(id);
      rows.push({
        // India is qualified (NSE:X) so history routing skips the master lookup; US stays bare.
        value: market === 'india' ? `NSE:${sym}` : sym,
        symbol: sym, exchange: ex, market, description: desc.slice(0, 60), rel,
      });
    }
    // Exact ticker first, then prefix matches ahead of name-only matches. Within a tier
    // NSE leads (this dashboard is India-first), then the shortest ticker — which is
    // almost always the primary common-stock listing.
    rows.sort((a, b) => (a.symbol === key ? -1 : b.symbol === key ? 1 : 0)
      || a.rel - b.rel
      || (a.market === b.market ? 0 : a.market === 'india' ? -1 : 1)
      || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol));
    rows.splice(12);
    rows.forEach(r => delete r.rel);
    _search.set(key, { ts: Date.now(), rows });
    return { ok: true, q: key, rows };
  } catch (e) {
    return { ok: false, q: key, rows: [], error: e.message };
  }
}

export { TFS };
