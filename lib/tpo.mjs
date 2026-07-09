// lib/tpo.mjs — TPO / Market-Profile-informed INTRADAY scanner. ANALYSIS ONLY.
// Market-parameterized: India (NSE) and USA (NASDAQ/NYSE/AMEX). One scoring engine.
//
// Data source: TradingView's public scanner (scanner.tradingview.com/<region>/scan),
// fetched SERVER-SIDE with Node's built-in fetch — no new dependency, no chart
// disruption. It returns real day-level fields for the full universe.
//
// The scanner gives DAY aggregates, not intraday time-at-price, so true letter-by-
// letter TPO (POC/VAH/VAL/IB/single prints) cannot be computed here for every name.
// Stage 1 (this file) is a Market-Profile-INFORMED structural screen using native TPO
// concepts (opening location, value acceptance/rejection, IB / range extension, trend-
// day, relative-volume conviction). True per-symbol TPO levels are read on demand from
// the chart via server.mjs -> confirmTPO (Stage 2).
//
// STABLE ENTRIES (the key intraday fix): the entry is anchored to levels that are FIXED
// for the whole session — today's Open and the prior-day close (PDC = close/(1+chg%)) —
// NOT the live (H+L+C)/3 pivot, which drifts with every LTP tick. On top of that, the
// first time a symbol qualifies during a session its full plan (entry/SL/targets) is
// FROZEN in a per-session cache and reused unchanged for the rest of the day; only the
// live LTP and the signal STATE (armed/valid/extended/invalid/expired) update. So a
// trader always sees the same entry level they can actually work an order around.
//
// CIRCUIT LIMITS (India): Stage-1 clamps targets/SL to an ASSUMED band (PDC ± band%,
// config tpo.india.circuitBandPct) as a safety net — the free scanner exposes no real
// circuit. The Confirm step swaps in the stock's TRUE circuit from Upstox (lib/upstox).
//
// Real-time: the India scanner returns `streaming` anonymously. USA is 15-min delayed
// anonymously but `streaming` with the user's logged-in TV session cookie (read via CDP).

import { getSessionCookie } from './tv.mjs';

// Per-market config. `region` = scanner path segment; `index*` drives the index-alignment
// score; `exchanges` scopes the universe; `needsAuth` = attach the TV session cookie
// (USA only). `tz`/`open`/`close` (minutes past midnight, market-local) drive session
// timing for entry validity + expiry.
const MARKETS = {
  india: { region: 'india', indexTicker: 'NSE:NIFTY', indexLabel: 'NIFTY', exchanges: ['NSE'], needsAuth: false,
    tz: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 },
  usa: { region: 'america', indexTicker: 'SP:SPX', indexLabel: 'S&P 500', exchanges: ['NASDAQ', 'NYSE', 'AMEX'], needsAuth: true,
    tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
};

// Columns we read (verified present on both scans). Order matters — the scanner returns
// values as a positional array per symbol.
const COLS = ['name', 'close', 'open', 'high', 'low', 'volume', 'VWAP',
  'relative_volume_10d_calc', 'change', 'gap', 'ATR', 'average_volume_10d_calc', 'update_mode'];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Rate-limit guard: never hit the scanner more than once per this interval per market.
const MIN_INTERVAL_MS = 12000;
const _cache = {};   // marketKey -> { ts, result }
const _plans = {};   // marketKey -> { dateKey, map: Map<ticker, frozenPlan> }

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

async function post(region, body, cookie) {
  const headers = {
    'content-type': 'application/json', 'user-agent': UA,
    'origin': 'https://www.tradingview.com', 'referer': 'https://www.tradingview.com/',
  };
  if (cookie) headers['cookie'] = cookie;
  const r = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`scanner HTTP ${r.status}`);
  return r.json();
}

// ---- session timing (market-local, DST-safe via Intl) ---------------------
function sessionInfo(m) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: m.tz, weekday: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = k => parts.find(x => x.type === k)?.value;
  const hh = (+g('hour')) % 24, mm = +g('minute');
  const cur = hh * 60 + mm;
  const weekend = g('weekday') === 'Sat' || g('weekday') === 'Sun';
  return {
    dateKey: `${g('year')}-${g('month')}-${g('day')}`,
    curMin: cur,
    weekend,
    isOpen: !weekend && cur >= m.open && cur < m.close,
    minsToClose: weekend ? -1 : (m.close - cur),   // negative once past close
  };
}

// Frozen-plan cache, reset each session-date per market.
function planMap(marketKey, dateKey) {
  const c = _plans[marketKey];
  if (!c || c.dateKey !== dateKey) { _plans[marketKey] = { dateKey, map: new Map() }; }
  return _plans[marketKey].map;
}

// ---- signal state machine -------------------------------------------------
// Given a FROZEN plan + the live LTP + minutes-to-close, classify where the signal is.
function computeState(p, ltp, minsToClose, cutoffMin) {
  const long = p.signal === 'LONG';
  const risk = Math.abs(p.entry - p.sl) || 1e-9;
  const t1 = p.targets[0];
  const beyond = long ? (ltp - p.entry) : (p.entry - ltp);   // progress past entry, trade dir
  const stopHit = long ? ltp <= p.sl : ltp >= p.sl;
  const t1Hit = long ? ltp >= t1 : ltp <= t1;

  if (stopHit) return { state: 'INVALID', note: 'Price reached the stop level — setup invalidated for the session.' };
  if (t1Hit) return { state: 'TARGET', note: 'Target 1 reached — trail the runner toward Target 2 or book profits.' };
  if (minsToClose != null && minsToClose <= 0) return { state: 'EXPIRED', note: 'Market closed — signal expired.' };
  if (beyond > 0.5 * risk) return { state: 'EXTENDED', note: 'Price extended >0.5R past entry — do NOT chase. Wait for a pullback into the entry zone.' };
  if (beyond >= -0.15 * risk) return { state: 'VALID', note: 'In the entry zone now — valid to enter on a confirmed hold/retest.' };
  if (minsToClose != null && minsToClose <= cutoffMin) return { state: 'EXPIRED', note: `Under ${cutoffMin}m to close — too late to initiate a new intraday entry.` };
  return { state: 'ARMED', note: 'Waiting for price to reach the entry zone (breakout/retest).' };
}

// Clamp a plan's targets/SL to a circuit band and recompute R:R. Reused by Confirm with
// the REAL Upstox circuit. Generic for long & short.
export function clampToCircuit(plan, upper, lower, source = 'assumed') {
  const long = plan.signal === 'LONG';
  let [t1, t2] = plan.targets, sl = plan.sl, capped = false;
  if (upper != null) { if (t1 > upper) { t1 = upper; capped = true; } if (t2 > upper) { t2 = upper; capped = true; } }
  if (lower != null) { if (t1 < lower) { t1 = lower; capped = true; } if (t2 < lower) { t2 = lower; capped = true; } }
  if (long && lower != null && sl < lower) { sl = lower; capped = true; }     // long stop can't sit below lower circuit
  if (!long && upper != null && sl > upper) { sl = upper; capped = true; }     // short stop can't sit above upper circuit
  const risk = Math.abs(plan.entry - sl) || 1e-9;
  return {
    ...plan, sl: r2(sl), targets: [r2(t1), r2(t2)], rr: r2(Math.abs(t1 - plan.entry) / risk),
    circuit: { upper: r2(upper), lower: r2(lower), source, capped },
  };
}

// ---- fetch helpers --------------------------------------------------------
async function indexChange(m, cookie) {
  try {
    const j = await post(m.region, { symbols: { tickers: [m.indexTicker] }, columns: ['change'] }, cookie);
    const v = j?.data?.[0]?.d?.[0];
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}

async function universe(m, cfg, cookie) {
  const filter = [
    { left: 'exchange', operation: 'in_range', right: m.exchanges },
    { left: 'is_primary', operation: 'equal', right: true },
    { left: 'type', operation: 'equal', right: 'stock' },
  ];
  if (cfg.minMarketCap) filter.push({ left: 'market_cap_basic', operation: 'greater', right: cfg.minMarketCap });
  const body = {
    filter, options: { lang: 'en' }, columns: COLS,
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
    range: [0, 10000],
  };
  const j = await post(m.region, body, cookie);
  return (j.data || []).map(row => {
    const d = row.d, o = {};
    COLS.forEach((c, i) => { o[c] = d[i]; });
    o.ticker = row.s;
    return o;
  });
}

function dataStatusOf(rows) {
  const modes = rows.map(r => r.update_mode).filter(Boolean);
  if (!modes.length) return { status: 'unknown', delayMin: null };
  const streaming = modes.filter(x => x === 'streaming').length;
  const delayed = modes.filter(x => /delayed/.test(x));
  const eod = modes.filter(x => /end_of_day|eod/i.test(x)).length;
  if (streaming >= modes.length * 0.5) return { status: 'live', delayMin: 0 };
  if (eod >= modes.length * 0.5) return { status: 'closed', delayMin: null };
  if (delayed.length) {
    const secs = parseInt((delayed[0].match(/(\d+)/) || [])[1] || '0', 10);
    return { status: 'delayed', delayMin: secs ? Math.round(secs / 60) : null };
  }
  return { status: 'unknown', delayMin: null };
}

// ---- score + build a raw plan for one symbol ------------------------------
// Returns a raw (unfrozen) opportunity or null if not a high-quality setup.
function evaluate(row, idxChg, cfg, m, marketKey) {
  const O = row.open, H = row.high, L = row.low, C = row.close;
  const pivot = row.VWAP;            // (H+L+C)/3 — labeled "Pivot"; used for scoring only, NOT entry
  const rVol = row.relative_volume_10d_calc;
  const chg = row.change, gap = row.gap, atr = row.ATR, avgVol = row.average_volume_10d_calc;
  if (![O, H, L, C, atr].every(v => typeof v === 'number' && isFinite(v))) return null;
  const range = H - L;
  if (range <= 0 || atr <= 0) return null;
  if (avgVol != null && avgVol < cfg.minAvgVol) return null;
  if (C < cfg.minPrice) return null;

  const pos = clamp((C - L) / range);          // 0=at low, 1=at high (value acceptance)
  const rangeATR = range / atr;
  const driveUp = (C - O) / atr, driveDn = (O - C) / atr;

  // Direction: only clean directional (initiative) setups qualify.
  let dir = 0;
  if (C > O && pos >= 0.55 && (chg ?? 0) > 0) dir = 1;
  else if (C < O && pos <= 0.45 && (chg ?? 0) < 0) dir = -1;
  if (!dir) return null;
  const long = dir === 1;

  // ---- score components (unchanged, all from real fields) -------------------
  const gapAligned = (long ? (gap ?? 0) > 0 : (gap ?? 0) < 0);
  const loc = clamp((gapAligned ? 0.5 : 0) + 0.5 * clamp(long ? driveUp : driveDn));
  const vsPivot = pivot != null ? clamp((long ? (C - pivot) : (pivot - C)) / atr) : 0.5;
  const acc = clamp(0.6 * (long ? pos : 1 - pos) + 0.4 * vsPivot);
  const ext = clamp((clamp(rangeATR / 1.6)) * (long ? pos : 1 - pos) * 1.15);
  const vol = rVol != null ? clamp(rVol / 2) : 0.3;
  const idx = idxChg == null ? 0.5 : ((long ? idxChg > 0 : idxChg < 0) ? 1 : 0);

  // ---- STABLE entry / SL / targets ------------------------------------------
  // Entry anchors to FIXED session levels (today's Open, prior-day close) — never the
  // moving pivot. Pick the nearest fixed level to retest in the trade direction.
  const pdc = (chg != null && isFinite(chg)) ? C / (1 + chg / 100) : null;   // prior-day close, fixed
  const buf = 0.25 * atr;
  let entry, anchorLabel, sl, t1, t2;
  if (long) {
    const below = [['Open', O], ['PDC', pdc]].filter(([, v]) => v != null && v < C);
    if (below.length) { const best = below.reduce((a, b) => (b[1] > a[1] ? b : a)); entry = best[1]; anchorLabel = best[0]; }
    else { entry = C; anchorLabel = 'LTP'; }
    sl = Math.max(L, entry - atr) - buf;         // tighter of day-low / 1-ATR stop, below entry
    t1 = H + 0.35 * range;                        // range-extension objectives (frozen on first qualify)
    t2 = H + 0.75 * range;
  } else {
    const above = [['Open', O], ['PDC', pdc]].filter(([, v]) => v != null && v > C);
    if (above.length) { const best = above.reduce((a, b) => (b[1] < a[1] ? b : a)); entry = best[1]; anchorLabel = best[0]; }
    else { entry = C; anchorLabel = 'LTP'; }
    sl = Math.min(H, entry + atr) + buf;
    t1 = L - 0.35 * range;
    t2 = L - 0.75 * range;
  }
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  const rr = Math.abs(t1 - entry) / risk;
  const rrScore = clamp((rr - 1) / 1.5);

  const W = { loc: 20, acc: 20, ext: 15, vol: 15, idx: 10, rr: 20 };
  const score = Math.round(loc * W.loc + acc * W.acc + ext * W.ext + vol * W.vol + idx * W.idx + rrScore * W.rr);
  if (score < cfg.minScore || rr < cfg.minRR || (rVol ?? 0) < cfg.minRVol) return null;

  const confidence = score >= 85 ? 'High' : score >= 75 ? 'Good' : 'Fair';
  const dayType = rangeATR >= 1.4 && (long ? pos >= 0.75 : pos <= 0.25) ? 'trend-day'
    : rangeATR < 0.9 ? 'balanced/normal-day' : 'normal-day';
  const bits = [];
  bits.push(`Open-${long ? 'drive up' : 'drive down'} (gap ${gap >= 0 ? '+' : ''}${r2(gap)}%)`);
  bits.push(`accepting ${long ? 'upper' : 'lower'} value (${Math.round(pos * 100)}% of day range${pivot != null ? `, ${long ? 'above' : 'below'} pivot` : ''})`);
  bits.push(`range ${r2(rangeATR)}× ATR (${dayType})`);
  if (rVol != null) bits.push(`rVol ${r2(rVol)}×`);
  if (idxChg != null) bits.push(idx ? `aligned with ${m.indexLabel}` : `against ${m.indexLabel}`);
  bits.push(`entry anchored to ${anchorLabel} (fixed)`);

  let plan = {
    symbol: row.name, ticker: row.ticker,
    signal: long ? 'LONG' : 'SHORT',
    entry: r2(entry), sl: r2(sl), targets: [r2(t1), r2(t2)], rr: r2(rr),
    score, confidence, reason: bits.join(' · '),
    anchor: anchorLabel, pos: Math.round(pos * 100),
    // live-ish fields (informational; refreshed each scan even when the plan is frozen)
    ltp: r2(C), rVol: r2(rVol), changePct: r2(chg),
    circuit: null,
  };

  // Stage-1 India safety clamp: assumed band around PDC (real circuit comes at Confirm).
  if (marketKey === 'india' && cfg.circuitBandPct && pdc != null) {
    const band = cfg.circuitBandPct;
    plan = clampToCircuit(plan, pdc * (1 + band / 100), pdc * (1 - band / 100), 'assumed');
    plan.circuit.band = band;
  }
  return plan;
}

// ---- Stage 1: scan a market's full universe, freeze plans, classify state --
export async function scanTPO(cfg = {}, marketKey = 'india') {
  const m = MARKETS[marketKey];
  if (!m) throw new Error(`unknown market: ${marketKey}`);

  const cached = _cache[marketKey];
  if (cached && Date.now() - cached.ts < MIN_INTERVAL_MS) return { ...cached.result, cached: true };

  const conf = {
    minScore: cfg.minScore ?? 70, minRR: cfg.minRR ?? 1.5, minRVol: cfg.minRVol ?? 1.2,
    minAvgVol: cfg.minAvgVol ?? 50000, minPrice: cfg.minPrice ?? 20,
    minMarketCap: cfg.minMarketCap ?? 0, top: cfg.top ?? 40,
    circuitBandPct: cfg.circuitBandPct ?? 0,
    noNewEntryBeforeCloseMin: cfg.noNewEntryBeforeCloseMin ?? 45,
  };

  const sess = sessionInfo(m);
  const plans = planMap(marketKey, sess.dateKey);

  const cookie = m.needsAuth ? await getSessionCookie() : '';
  const [rows, idxChg] = await Promise.all([universe(m, conf, cookie), indexChange(m, cookie)]);
  const { status, delayMin } = dataStatusOf(rows);

  const out = [];
  for (const row of rows) {
    const raw = evaluate(row, idxChg, conf, m, marketKey);
    if (!raw) continue;

    // Freeze the plan the first time this symbol qualifies today; reuse thereafter so the
    // entry/SL/targets never move. Live LTP + state are recomputed each scan.
    let plan = plans.get(raw.ticker);
    if (!plan) {
      plan = {
        signal: raw.signal, entry: raw.entry, sl: raw.sl, targets: raw.targets, rr: raw.rr,
        score: raw.score, confidence: raw.confidence, reason: raw.reason, anchor: raw.anchor,
        pos: raw.pos, circuit: raw.circuit, triggerTs: Date.now(),
        symbol: raw.symbol, ticker: raw.ticker,
      };
      plans.set(raw.ticker, plan);
    }

    const ltp = raw.ltp;
    const { state, note } = computeState(plan, ltp, sess.minsToClose, conf.noNewEntryBeforeCloseMin);
    const risk = Math.abs(plan.entry - plan.sl) || 1e-9;
    const long = plan.signal === 'LONG';
    const zLo = r2(long ? plan.entry - 0.1 * risk : plan.entry - 0.35 * risk);
    const zHi = r2(long ? plan.entry + 0.35 * risk : plan.entry + 0.1 * risk);

    out.push({
      symbol: plan.symbol, ticker: plan.ticker, signal: plan.signal,
      entry: plan.entry, sl: plan.sl, targets: plan.targets, rr: plan.rr,
      score: plan.score, confidence: plan.confidence, reason: plan.reason,
      anchor: plan.anchor, pos: plan.pos, circuit: plan.circuit,
      ltp, rVol: raw.rVol, changePct: raw.changePct,
      state, stateNote: note,
      entryZone: [zLo, zHi],
      triggerTime: new Date(plan.triggerTs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    });
  }

  // Rank valid/actionable setups first, then by conviction.
  const rank = s => ({ VALID: 0, ARMED: 1, EXTENDED: 2, TARGET: 3, EXPIRED: 4, INVALID: 5 }[s] ?? 9);
  out.sort((a, b) => rank(a.state) - rank(b.state) || b.score - a.score);

  const note = status === 'live' ? 'Real-time scanner data. Stage-1 profile-informed structural scan — entries are fixed for the session; use per-row Confirm for true on-chart levels + real circuit.'
    : status === 'delayed' ? `Delayed scanner data (~${delayMin ?? 15}m). ${m.needsAuth ? 'Log in to TradingView Desktop (CDP) for real-time.' : ''} Stage-1 profile-informed structural scan.`
    : status === 'closed' ? 'Market closed — showing last session’s data (signals expired). Stage-1 profile-informed structural scan.'
    : 'Server-side scanner data. Stage-1 profile-informed structural scan.';

  const result = {
    ts: Date.now(), market: marketKey, universe: rows.length,
    indexLabel: m.indexLabel, indexChangePct: r2(idxChg),
    dataStatus: status, delayMin,
    session: { isOpen: sess.isOpen, minsToClose: sess.minsToClose >= 0 ? sess.minsToClose : null },
    count: out.length, rows: out.slice(0, conf.top), note,
  };
  _cache[marketKey] = { ts: Date.now(), result };
  return result;
}
