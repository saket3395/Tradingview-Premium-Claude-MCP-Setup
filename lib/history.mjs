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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrumentKeyFor } from './upstox.mjs';
import { limitedFetch, breakerState } from './ratelimit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DISK = join(ROOT, 'data', 'history_cache.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TFS = ['4H', '1D', '1W', '1M'];

// Symbol-level cache. History moves slowly; 5 min keeps the tab snappy and polite.
const CACHE_MS = 5 * 60 * 1000;
const _cache = new Map();   // key -> { ts, data }

// ---- per-request candle cache ----------------------------------------------
// Upstox itself returns `Cache-Control: max-age=14400` on these responses — the data is
// settled and there is no reason to refetch it every few minutes. Caching each window
// separately (rather than only whole symbols) means a partial failure re-fetches just the
// timeframe that failed, instead of all five calls again.
const _bars = new Map();    // key -> { ts, ttl, bars }

// Restore the settled windows from disk at startup. Without this, every server restart
// refetched all five windows for every symbol — a refetch storm straight into the block.
try {
  if (existsSync(DISK)) {
    const j = JSON.parse(readFileSync(DISK, 'utf8'));
    for (const [k, v] of Object.entries(j.entries || {})) {
      if (Date.now() - v.ts < v.ttl) _bars.set(k, v);
    }
  }
} catch {}

// Debounced write. It must DEFER the write, not drop it: an earlier version returned
// early inside the debounce window and only wrote again on the next store, so a burst of
// fetches persisted whichever single window happened to land first — and if no further
// fetch followed, nothing was ever written at all.
let _timer = null;
function flushDisk() {
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    try {
      // Only the long-lived windows are worth persisting; intraday churns and is bulky.
      // Capped so the file stays bounded once 30-minute windows start persisting overnight
      // (a 30m window is ~1,500 bars, far bigger than a daily one).
      const live = [..._bars].filter(([, v]) => v.ttl >= 60 * 60 * 1000 && Date.now() - v.ts < v.ttl)
        .sort((a, b) => b[1].ts - a[1].ts).slice(0, 200);
      const entries = Object.fromEntries(live);
      mkdirSync(dirname(DISK), { recursive: true });
      writeFileSync(DISK, JSON.stringify({ ts: Date.now(), entries }));
    } catch {}
  }, 2000);
  _timer.unref?.();                 // never keep the process alive just to flush a cache
}

function barsCached(key) {
  const hit = _bars.get(key);
  return hit && Date.now() - hit.ts < hit.ttl ? hit.bars : null;
}
function barsStore(key, bars, ttl) {
  _bars.set(key, { ts: Date.now(), ttl, bars });
  if (_bars.size > 400) _bars.delete(_bars.keys().next().value);
  flushDisk();
  return bars;
}
// Cache lifetime per window, matched to how often that bar can actually change. A monthly
// bar changes once a month and a weekly one once a week — refetching them hourly was the
// main source of sustained request volume. While the market is shut, nothing changes at
// all, so everything is held far longer.
const HOUR = 60 * 60 * 1000;
export function ttlFor(interval, now = new Date()) {
  const open = nseOpen(now);
  // Weekly and monthly deep history is fetched ONCE. Its old bars can never change, and
  // its recent bars are rebuilt exactly from daily (see deriveFrom), so it does not need
  // refetching for a long time — this is what removes two calls per symbol per day.
  if (interval === 'week' || interval === 'month') return 30 * 24 * HOUR;
  if (interval === 'intraday') return 2 * 60 * 1000;
  // Everything else is settled the moment the market shuts: hold it until the next open.
  if (!open) return Math.max(msToNextOpen(now), 5 * 60 * 1000);
  return interval === '30minute' ? 10 * 60 * 1000 : 4 * HOUR;   // Upstox's own max-age is 4h
}
const TTL = { alpaca: 30 * 60 * 1000 };

export const isIndia = symbol => /^(NSE|BSE)[:_]/i.test(String(symbol || ''));
export const bareSymbol = s => String(s || '').split(':').pop().trim().toUpperCase().replace(/\s+/g, '');

// Milliseconds until the next NSE session opens. While the market is shut nothing can
// change, so a window fetched yesterday evening stays valid right up to tomorrow's open —
// which is what makes a symbol analysed yesterday cost ZERO requests this morning.
export function msToNextOpen(now = new Date()) {
  const OPEN = 9 * 60 + 15;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now);
  const g = k => p.find(x => x.type === k)?.value;
  const cur = (+g('hour') % 24) * 60 + (+g('minute'));
  const secs = +g('second');
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday'));
  let days = 0;
  if (cur >= OPEN) days = 1;                       // today's open has passed
  // Skip weekends (NSE trades Mon-Fri; exchange holidays merely make this conservative).
  for (let i = 0; i < 7; i++) {
    const d = (dow + days) % 7;
    if (d !== 0 && d !== 6) break;
    days++;
  }
  return ((days * 1440) + OPEN - cur) * 60000 - secs * 1000;
}

// NSE session state. Settled bars cannot change while the market is shut, so this drives
// both the intraday skip and how long each window stays cached.
export function nseOpen(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = k => p.find(x => x.type === k)?.value;
  const cur = (+g('hour') % 24) * 60 + (+g('minute'));
  const weekend = g('weekday') === 'Sat' || g('weekday') === 'Sun';
  return !weekend && cur >= 9 * 60 + 15 && cur < 15 * 60 + 30;
}

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
  const key = `u|${ik}|${interval}|${from}|${to}`;
  const hit = barsCached(key);
  if (hit) return hit;
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(ik)}/${interval}/${to}/${from}`;
  const res = await limitedFetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  }, 'Upstox');
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.errors?.[0]?.message || `Upstox ${interval} HTTP ${res.status}`);
  const bars = (j?.data?.candles || [])
    .map(c => ({ t: Date.parse(c[0]), iso: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] }))
    .sort((a, b) => a.t - b.t);
  return barsStore(key, bars, ttlFor(interval));
}

// Today's (still-running) session — the historical endpoint excludes it.
async function upstoxIntraday(ik, interval, token) {
  const key = `ui|${ik}|${interval}`;
  const hit = barsCached(key);
  if (hit) return hit;
  if (breakerState('Upstox')) return [];      // best-effort only; never burn the breaker on it
  const res = await limitedFetch(`https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(ik)}/${interval}/`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(12000),
  }, 'Upstox');
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return barsStore(key, (j?.data?.candles || [])
    .map(c => ({ t: Date.parse(c[0]), iso: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] }))
    .sort((a, b) => a.t - b.t), ttlFor('intraday'));
}

// Rebuild the weekly / monthly bars that our daily window covers, straight from daily.
// A day never straddles a week or month boundary, so this is EXACT — verified at 0.0000%
// error across 1,520 OHLC fields. (The reverse, weekly -> monthly, is not: weeks do
// straddle months, which produced up to 10.47% error and was rejected.)
// Older periods, outside the daily window, are kept from the fetched series unchanged.
const weekKey = iso => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
};
const periodKey = (iso, kind) => (kind === 'month' ? iso.slice(0, 7) : weekKey(iso));

function deriveFrom(daily, kind) {
  const by = new Map();
  for (const b of daily) {
    const k = periodKey(b.iso, kind);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(b);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, g]) => ({
    key: k, t: g[0].t, iso: g[0].iso, o: g[0].o, c: g[g.length - 1].c,
    h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)),
    v: g.reduce((s, x) => s + (x.v || 0), 0),
  }));
}

function refreshFromDaily(fetched, daily, kind) {
  if (!daily?.length || !fetched?.length) return fetched;
  const derived = deriveFrom(daily, kind);
  if (derived.length < 2) return fetched;
  // derived[0] is clipped by where the daily window starts, so it is dropped and the
  // fetched bar for that period is kept instead.
  const rebuilt = derived.slice(1);
  // Match on PERIOD KEY, never on timestamp: Upstox dates a monthly bar at the 1st of the
  // month while a derived one starts on the month's first TRADING day, so a timestamp
  // comparison keeps both and duplicates the period. The same applies to a week whose
  // Monday is a holiday.
  const replaced = new Set(rebuilt.map(d => d.key));
  const kept = fetched.filter(b => !replaced.has(periodKey(b.iso, kind)));
  return [...kept, ...rebuilt.map(({ key, ...b }) => b)].sort((a, b) => a.t - b.t);
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
  // If the breaker is already open, say so once and clearly rather than repeating the
  // same rate-limit sentence for all four timeframes.
  const open = breakerState('Upstox');
  if (open) return { ok: false, rateLimited: true, retryInSec: open,
    error: `Upstox is rate limiting this IP (Cloudflare 1015). Analysis paused for ${open}s — data already cached still works.` };
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
    if (nseOpen()) { try { live = await upstoxIntraday(ik, '30minute', token); } catch {} }
    const seen = new Set(done.map(b => b.iso));
    return [...done, ...live.filter(b => !seen.has(b.iso))].sort((a, b) => a.t - b.t);
  })();

  const jobs = {
    '4H': m30.then(to4H),
    '1D': upstoxCandles(ik, 'day', daysAgo(450), daysAgo(0), token),   // >252 bars: true 52-week high/low
    '1W': upstoxCandles(ik, 'week', daysAgo(1800), daysAgo(0), token),
    '1M': upstoxCandles(ik, 'month', daysAgo(2500), daysAgo(0), token),
  };
  const tfs = {};
  await Promise.all(TFS.map(async tf => {
    try { tfs[tf] = { ok: true, bars: await jobs[tf] }; }
    catch (e) { tfs[tf] = { ok: false, error: e.message, bars: [] }; }
  }));
  // Bring long-cached weekly/monthly fully up to date from daily, exactly, without a call.
  if (tfs['1D']?.ok) {
    if (tfs['1W']?.ok) tfs['1W'].bars = refreshFromDaily(tfs['1W'].bars, tfs['1D'].bars, 'week');
    if (tfs['1M']?.ok) tfs['1M'].bars = refreshFromDaily(tfs['1M'].bars, tfs['1D'].bars, 'month');
  }
  return { ok: true, market: 'india',
    source: 'Upstox historical-candle (4H aggregated from 30m, NSE session-anchored; weekly/monthly kept current from daily)', tfs };
}

// ---- USA: Alpaca -----------------------------------------------------------
async function alpacaBars(sym, timeframe, start, key, secret, feed) {
  const ck = `a|${sym}|${timeframe}|${start}|${feed}`;
  const hit = barsCached(ck);
  if (hit) return hit;
  const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(sym)}`
    + `&timeframe=${timeframe}&start=${start}&limit=10000&feed=${feed}&adjustment=all&sort=asc`;
  const res = await limitedFetch(url, {
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  }, 'Alpaca');
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.message || `Alpaca ${timeframe} HTTP ${res.status}`);
  const rows = j?.bars?.[sym] || [];
  if (!rows.length) throw new Error(`Alpaca returned no ${timeframe} bars for ${sym}.`);
  return barsStore(ck, rows.map(b => ({ t: Date.parse(b.t), iso: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })), TTL.alpaca);
}

async function usaSeries(symbol) {
  const open = breakerState('Alpaca');
  if (open) return { ok: false, rateLimited: true, retryInSec: open,
    error: `Alpaca is rate limiting this IP. Analysis paused for ${open}s — data already cached still works.` };
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
  // `ok` must mean "this carries usable data". It previously meant only "the provider was
  // reachable", which was true even when every timeframe had errored — the ambiguity that
  // let a rate-limited burst be cached as success and pin the failure for five minutes.
  const tfOk = Object.values(out.tfs || {}).filter(t => t.ok).length;
  const usable = out.ok && tfOk > 0;
  const data = { ...out, ok: usable, symbol: cacheKey, asOf: Date.now() };
  if (!usable && out.ok) {
    const errs = Object.entries(out.tfs || {}).map(([k, v]) => `${k}: ${v.error}`);
    const limited = errs.find(e => /rate limit/i.test(e));
    // Collapse four identical rate-limit messages into the one fact that matters.
    data.error = limited ? limited.replace(/^\S+: /, '') : `No timeframe returned data — ${errs.join(' · ')}`;
    data.rateLimited = !!limited;
  }
  // Only a result with data is worth caching; a transient failure must expire at once.
  if (usable) _cache.set(cacheKey, { ts: Date.now(), data });
  else _cache.delete(cacheKey);
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
