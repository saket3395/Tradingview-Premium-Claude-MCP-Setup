// lib/journal.mjs — forward-test journal for TPO scanner plans. ANALYSIS ONLY.
//
// Every frozen plan the scanner produces is recorded here, and its outcome is
// resolved automatically from subsequent scans (real LTP/state transitions — no
// mock data, no hindsight). Rules, per the agreed methodology:
//   - A trade only COUNTS toward PF / win-rate once its state actually reached
//     VALID (price traded into the entry zone → a real trader could have filled).
//   - Plans that go straight to TARGET / INVALID / EXPIRED without ever being
//     VALID are tracked separately as MISSED (fill-rate stat), not as trades.
//   - WIN  = filled, then Target-1 hit  → realized R = planned R:R (exit at T1).
//   - LOSS = filled, then stop hit      → realized R = -1.
//   - SCRATCH = filled, session expired → realized R marked-to-last-LTP.
// Persisted to data/journal.json (debounced), in-memory Map for speed.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'journal.json');
const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

let _trades = null;                 // Map<id, trade>
let _saveTimer = null;

function load() {
  if (_trades) return _trades;
  _trades = new Map();
  try {
    if (existsSync(FILE)) {
      const j = JSON.parse(readFileSync(FILE, 'utf8'));
      for (const t of (Array.isArray(j) ? [] : j.trades) || []) _trades.set(t.id, t);
    }
  } catch {}
  return _trades;
}

function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify({ v: 1, trades: [..._trades.values()] }));
    } catch {}
  }, 2000);
}

const idOf = (market, dateKey, ticker) => `${market}:${dateKey}:${ticker}`;

// Called by the scanner the moment a plan is frozen (first qualification today).
export function recordPlan(market, dateKey, plan) {
  const trades = load();
  const id = idOf(market, dateKey, plan.ticker);
  if (trades.has(id)) return;
  trades.set(id, {
    id, market, date: dateKey,
    symbol: plan.symbol, ticker: plan.ticker, signal: plan.signal,
    entry: plan.entry, sl: plan.sl, targets: plan.targets, rr: plan.rr,
    score: plan.score, confidence: plan.confidence, setup: plan.setup || 'EXPANSION',
    entryQuality: plan.entryQuality ?? null,
    triggerTs: plan.triggerTs,
    filled: false, fillTs: null,
    status: 'OPEN',               // OPEN -> CLOSED | MISSED
    outcome: null,                // WIN | LOSS | SCRATCH (filled trades only)
    exit: null, rMultiple: null, lastLtp: null, closedTs: null,
  });
  save();
}

// Called by the scanner on every scan with the fresh state/LTP for a live plan.
export function observePlan(market, dateKey, ticker, { state, ltp }) {
  const t = load().get(idOf(market, dateKey, ticker));
  if (!t || t.status !== 'OPEN') return;
  t.lastLtp = ltp;
  if (!t.filled && state === 'VALID') { t.filled = true; t.fillTs = Date.now(); }

  const risk = Math.abs(t.entry - t.sl) || 1e-9;
  const close = (outcome, exit, r) => {
    t.status = t.filled ? 'CLOSED' : 'MISSED';
    if (t.filled) { t.outcome = outcome; t.exit = r2(exit); t.rMultiple = r2(r); }
    t.closedTs = Date.now();
  };
  if (state === 'INVALID') close('LOSS', t.sl, -1);
  else if (state === 'TARGET') close('WIN', t.targets[0], t.rr);
  else if (state === 'EXPIRED' && ltp != null) {
    const signedR = (t.signal === 'LONG' ? ltp - t.entry : t.entry - ltp) / risk;
    close('SCRATCH', ltp, signedR);
  }
  save();
}

// Current date (YYYY-MM-DD) in US-market time — the earliest calendar date across
// the India (IST) and US (ET) sessions, so any plan dated before it has certainly
// finished its own session and can be safely finalized.
function nyDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Finalize plans whose session has ended but were never observed to a terminal
// state (scanner down at the close, or the symbol left the top-N scan). Without
// this a plan orphaned on its own session day stays OPEN forever once the date
// rolls and its in-memory plan map resets — so the Testing/Analytics tabs never
// see a single closed trade. Same resolution rules as observePlan's EXPIRED path:
// unfilled -> MISSED (fill-rate only); filled -> SCRATCH marked to last seen LTP.
export function sweepStale(cutoff = nyDateKey()) {
  const trades = load();
  let changed = false;
  for (const t of trades.values()) {
    if (t.status !== 'OPEN' || t.date >= cutoff) continue;
    if (t.filled) {
      const risk = Math.abs(t.entry - t.sl) || 1e-9;
      const exit = t.lastLtp != null ? t.lastLtp : t.entry;
      const r = (t.signal === 'LONG' ? exit - t.entry : t.entry - exit) / risk;
      t.status = 'CLOSED'; t.outcome = 'SCRATCH'; t.exit = r2(exit); t.rMultiple = r2(r);
    } else {
      t.status = 'MISSED';
    }
    t.closedTs = t.closedTs || Date.now();
    changed = true;
  }
  if (changed) save();
  return trades;
}

export function allTrades() {
  sweepStale();
  return [...load().values()].sort((a, b) => b.triggerTs - a.triggerTs);
}

// Merge precise backtest results (lib/backtest.mjs) back onto journal rows.
export function attachBacktest(id, bt) {
  const t = load().get(id);
  if (t) { t.backtest = bt; save(); }
}

// ---- statistics -------------------------------------------------------------
// PF / WR / expectancy over CLOSED+filled trades; MISSED feeds fill-rate only.
export function stats(trades) {
  const closed = trades.filter(t => t.status === 'CLOSED' && t.rMultiple != null);
  const missed = trades.filter(t => t.status === 'MISSED');
  const rs = closed.map(t => t.rMultiple);
  const wins = rs.filter(r => r > 0.05), losses = rs.filter(r => r < -0.05);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const wr = closed.length ? 100 * wins.length / closed.length : null;
  const expectancy = closed.length ? rs.reduce((a, b) => a + b, 0) / closed.length : null;
  const avgPlannedRR = closed.length ? closed.reduce((a, t) => a + (t.rr || 0), 0) / closed.length : null;
  return {
    open: trades.filter(t => t.status === 'OPEN').length,
    trades: closed.length, wins: wins.length, losses: losses.length,
    scratches: closed.length - wins.length - losses.length,
    missed: missed.length,
    fillRate: (closed.length + missed.length) ? r2(100 * closed.length / (closed.length + missed.length)) : null,
    profitFactor: pf === Infinity ? '∞' : r2(pf),
    winRate: r2(wr), expectancyR: r2(expectancy), avgPlannedRR: r2(avgPlannedRR),
    totalR: r2(rs.reduce((a, b) => a + b, 0)),
    rMultiples: rs,
  };
}

// Gate evaluation: PF ≥ 1.5, WR ≥ 40%, avg planned R:R ≥ 2.0. null until n ≥ minN.
export function gates(s, g = { pf: 1.5, wr: 40, rr: 2.0, minN: 20 }) {
  const enough = s.trades >= g.minN;
  const pfNum = s.profitFactor === '∞' ? Infinity : s.profitFactor;
  return {
    sampleOk: enough, minN: g.minN,
    pf: { target: g.pf, value: s.profitFactor, pass: enough ? pfNum >= g.pf : null },
    wr: { target: g.wr, value: s.winRate, pass: enough ? s.winRate >= g.wr : null },
    rr: { target: g.rr, value: s.avgPlannedRR, pass: enough ? s.avgPlannedRR >= g.rr : null },
  };
}

// Full Testing-tab payload: overall + per market / setup / confidence breakdowns.
export function summary(gateCfg) {
  const all = allTrades();
  const group = keyFn => {
    const m = {};
    for (const t of all) { const k = keyFn(t); (m[k] = m[k] || []).push(t); }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...stats(v), rMultiples: undefined }]));
  };
  const overall = stats(all);
  return {
    ts: Date.now(), total: all.length,
    overall: { ...overall, rMultiples: undefined },
    gates: gates(overall, gateCfg),
    byMarket: group(t => t.market),
    bySetup: group(t => t.setup),
    byConfidence: group(t => t.confidence),
    recent: all.slice(0, 100).map(({ rMultiples, ...t }) => t),
  };
}
