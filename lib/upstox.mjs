// lib/upstox.mjs — real NSE upper/lower circuit limits from Upstox. ANALYSIS ONLY.
//
// Used by the TPO Confirm step (India) to replace the assumed circuit band with the
// stock's TRUE daily circuit, so targets/SL can be validated against the real limits.
//
// Zero new dependency (Node built-in fetch + zlib). Two public inputs:
//   1. Instrument master — public, no credentials:
//      https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
//      maps trading_symbol ("RELIANCE") -> instrument_key ("NSE_EQ|INE002A01018").
//      Downloaded once, cached in memory + data/upstox_instruments.json (gitignored).
//   2. Market-quote — needs the user's access token (NSE_DATA_TOKEN_FILE, legacy UPSTOX_TOKEN_FILE):
//      GET https://api.upstox.com/v2/market-quote/quotes?instrument_key=...
//      returns upper_circuit_limit / lower_circuit_limit / last_price.
//
// Everything degrades gracefully: any failure (no token, stale token, network, unknown
// symbol) returns { ok:false, error } — the caller then falls back to the assumed band.
// api.upstox.com sits behind Cloudflare bot protection, so requests use a browser UA.

import { gunzipSync } from 'node:zlib';
import { limitedFetch } from './ratelimit.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'upstox_instruments.json');
const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const QUOTE_URL = 'https://api.upstox.com/v2/market-quote/quotes';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

// ---- access token ---------------------------------------------------------
// Reads NSE_DATA_TOKEN_FILE (legacy UPSTOX_TOKEN_FILE still honored). Never throws.
function loadToken() {
  const file = process.env.NSE_DATA_TOKEN_FILE || process.env.UPSTOX_TOKEN_FILE;
  if (!file || !existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j.access_token || null;
  } catch { return null; }
}

// ---- instrument map (symbol -> instrument_key) ----------------------------
let _map = null;          // Map<string, string>
let _mapTs = 0;
const MAP_TTL = 12 * 3600 * 1000; // refresh daily-ish

async function instrumentMap() {
  if (_map && Date.now() - _mapTs < MAP_TTL) return _map;
  // Try disk cache first (fast path across restarts within the day).
  try {
    if (existsSync(CACHE)) {
      const j = JSON.parse(readFileSync(CACHE, 'utf8'));
      if (j.ts && Date.now() - j.ts < MAP_TTL && j.map) {
        _map = new Map(Object.entries(j.map)); _mapTs = j.ts; return _map;
      }
    }
  } catch {}
  // Download the public master.
  const res = await fetch(INSTRUMENTS_URL, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`instruments HTTP ${res.status}`);
  const arr = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
  const map = {};
  for (const row of arr) {
    if (row.segment === 'NSE_EQ' && row.instrument_type === 'EQ' && row.trading_symbol && row.instrument_key) {
      map[row.trading_symbol.toUpperCase()] = row.instrument_key;
    }
  }
  _map = new Map(Object.entries(map)); _mapTs = Date.now();
  try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify({ ts: _mapTs, map })); } catch {}
  return _map;
}

// Normalize "NSE:RELIANCE" / "RELIANCE" -> "RELIANCE".
function bareSymbol(symbol) {
  return String(symbol || '').split(':').pop().trim().toUpperCase().replace(/\s+/g, '');
}

// ---- public: symbol -> Upstox instrument_key ------------------------------
// Exposed so other modules (lib/history.mjs) reuse this cached map instead of
// downloading or re-parsing the instrument master themselves.
export async function instrumentKeyFor(symbol) {
  const map = await instrumentMap();
  return map.get(bareSymbol(symbol)) || null;
}

// ---- public: fetch real circuit for one NSE symbol ------------------------
// Returns { ok:true, upper, lower, ltp, source:'upstox' } or { ok:false, error, reason }.
// `reason` is a short machine tag ('no_token' | 'stale_token' | 'unknown_symbol' | 'network').
export async function getCircuit(symbol) {
  const token = loadToken();
  if (!token) return { ok: false, reason: 'no_token', error: 'No NSE data token — point NSE_DATA_TOKEN_FILE at a long-lived analytics token (read-only, ~1yr validity, no daily refresh).' };

  const name = bareSymbol(symbol);
  let ik;
  try {
    const map = await instrumentMap();
    ik = map.get(name);
  } catch (e) { return { ok: false, reason: 'network', error: `instrument map: ${e.message}` }; }
  if (!ik) return { ok: false, reason: 'unknown_symbol', error: `No NSE_EQ instrument found for ${name}.` };

  try {
    const url = `${QUOTE_URL}?instrument_key=${encodeURIComponent(ik)}`;
    const res = await limitedFetch(url, {
      headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(8000),
    }, 'Upstox');
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || j?.errors?.some(e => /token/i.test(e.message || ''))) {
      return { ok: false, reason: 'stale_token', error: 'NSE data token invalid/expired — replace it with a long-lived analytics token (~1yr validity); plain OAuth tokens expire daily 03:30 IST.' };
    }
    if (!res.ok) return { ok: false, reason: 'network', error: `quote HTTP ${res.status}` };
    // Response: { status:'success', data: { 'NSE_EQ:RELIANCE': { upper_circuit_limit, lower_circuit_limit, last_price, ... } } }
    const data = j?.data || {};
    const row = data[`NSE_EQ:${name}`] || Object.values(data)[0];
    if (!row) return { ok: false, reason: 'network', error: 'Empty quote response from the NSE data provider.' };
    const upper = row.upper_circuit_limit ?? row.upperCircuitLimit;
    const lower = row.lower_circuit_limit ?? row.lowerCircuitLimit;
    if (!(upper > 0) || !(lower > 0)) return { ok: false, reason: 'network', error: 'Circuit limits absent in the provider quote.' };
    return { ok: true, source: 'upstox', upper: r2(upper), lower: r2(lower), ltp: r2(row.last_price ?? row.lastPrice ?? null) };
  } catch (e) {
    return { ok: false, reason: 'network', error: `NSE data quote: ${e.message}` };
  }
}
