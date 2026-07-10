// lib/backtest.mjs — replay journaled India TPO plans against REAL Upstox
// 1-minute historical candles. ANALYSIS ONLY, zero dependencies.
//
// The forward-test journal resolves outcomes at scan resolution (~30s..12s
// sampling of LTP). This module re-resolves each India plan minute-by-minute so
// fills / stop-outs / targets are exact, and merges the precise result back onto
// the journal row. USA is forward-test only (no free intraday history source —
// we do not fabricate data).
//
// Simulation rules (match the live state machine, conservative on ambiguity):
//   - Only candles AFTER the plan's trigger time count (no hindsight).
//   - FILL when a candle trades into the entry zone; fill price = plan entry.
//   - After fill: stop touch and T1 touch in the SAME candle → counted as LOSS.
//   - Session end without stop/target → SCRATCH at last close.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTrades, attachBacktest, stats, gates } from './journal.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

function loadToken() {
  const file = process.env.UPSTOX_TOKEN_FILE;
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')).access_token || null; } catch { return null; }
}

function instrumentKey(ticker) {
  // Reuse the instrument cache lib/upstox.mjs maintains (data/upstox_instruments.json).
  try {
    const j = JSON.parse(readFileSync(join(ROOT, 'data', 'upstox_instruments.json'), 'utf8'));
    return j.map?.[String(ticker).split(':').pop().toUpperCase()] || null;
  } catch { return null; }
}

// 1-minute candles for one symbol+date. Upstox v2: newest-first [ts,o,h,l,c,v,oi].
// The historical endpoint only serves COMPLETED days; the current session comes
// from the /intraday variant.
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
async function candles(ik, date, token) {
  const url = date === todayIST()
    ? `https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(ik)}/1minute/`
    : `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(ik)}/1minute/${date}/${date}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(12000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`candles HTTP ${res.status}`);
  return (j?.data?.candles || [])
    .map(c => ({ ts: Date.parse(c[0]), o: c[1], h: c[2], l: c[3], c: c[4] }))
    .sort((a, b) => a.ts - b.ts);
}

function simulate(t, bars) {
  const long = t.signal === 'LONG';
  const risk = Math.abs(t.entry - t.sl) || 1e-9;
  const [zLo, zHi] = long
    ? [t.entry - 0.1 * risk, t.entry + 0.35 * risk]
    : [t.entry - 0.35 * risk, t.entry + 0.1 * risk];
  const t1 = t.targets[0];
  let filled = false, fillTs = null;
  let last = null;
  for (const b of bars) {
    if (b.ts + 60_000 <= t.triggerTs) continue;   // candle ts = minute START; keep the trigger minute
    last = b;
    if (!filled) {
      if (b.l <= zHi && b.h >= zLo) { filled = true; fillTs = b.ts; }
      else continue;
    }
    const stopHit = long ? b.l <= t.sl : b.h >= t.sl;
    const t1Hit = long ? b.h >= t1 : b.l <= t1;
    if (stopHit) return { filled, fillTs, outcome: 'LOSS', exit: t.sl, rMultiple: -1, exitTs: b.ts }; // conservative if both
    if (t1Hit) return { filled, fillTs, outcome: 'WIN', exit: t1, rMultiple: r2(t.rr), exitTs: b.ts };
  }
  if (!filled) return { filled: false, outcome: 'MISSED', rMultiple: null };
  const r = (long ? last.c - t.entry : t.entry - last.c) / risk;
  return { filled, fillTs, outcome: 'SCRATCH', exit: r2(last.c), rMultiple: r2(r), exitTs: last?.ts };
}

// Backtest every journaled India plan at 1-minute resolution.
export async function runBacktest(gateCfg) {
  const token = loadToken();
  if (!token) return { ok: false, error: 'No Upstox token (set UPSTOX_TOKEN_FILE to a fresh daily token) — backtest needs historical candles.' };

  const india = allTrades().filter(t => t.market === 'india');
  if (!india.length) return { ok: false, error: 'Journal is empty — let the India TPO scanner run during a session first.' };

  const results = [], errors = [];
  for (const t of india) {
    const ik = instrumentKey(t.ticker);
    if (!ik) { errors.push(`${t.symbol}: no Upstox instrument (run a Confirm once to build the cache)`); continue; }
    try {
      const bars = await candles(ik, t.date, token);
      if (!bars.length) { errors.push(`${t.symbol} ${t.date}: no candles returned`); continue; }
      const sim = simulate(t, bars);
      attachBacktest(t.id, sim);
      results.push({
        id: t.id, symbol: t.symbol, date: t.date, signal: t.signal, setup: t.setup,
        entry: t.entry, sl: t.sl, t1: t.targets[0], rr: t.rr, ...sim,
        liveOutcome: t.outcome || t.status,
      });
      await new Promise(r => setTimeout(r, 250));   // stay well under Upstox rate limits
    } catch (e) { errors.push(`${t.symbol} ${t.date}: ${e.message}`); }
  }

  // Same statistics engine as the forward journal, on the precise outcomes.
  const asTrades = results.map(x => ({
    status: x.filled ? 'CLOSED' : 'MISSED', rMultiple: x.rMultiple, rr: x.rr,
  }));
  const s = stats(asTrades);
  return {
    ok: true, ts: Date.now(), market: 'india', resolution: '1-minute (Upstox historical)',
    tested: results.length, skipped: errors.length,
    summary: { ...s, rMultiples: undefined }, gates: gates(s, gateCfg),
    results: results.slice(0, 200), errors: errors.slice(0, 20),
  };
}
