// lib/tpo.mjs — TPO / Market-Profile-informed intraday scanner for NSE. ANALYSIS ONLY.
//
// Data source: TradingView's public scanner (scanner.tradingview.com/india/scan),
// fetched SERVER-SIDE with Node's built-in fetch — no new dependency, no chart
// disruption. It returns real day-level fields for the full NSE universe. Note:
// unauthenticated scanner data is typically ~15 min delayed (real but lagged).
//
// The scanner gives DAY aggregates, not intraday time-at-price, so true letter-by-
// letter TPO (POC/VAH/VAL/IB/single prints) cannot be computed here for every name.
// Stage 1 (this file) is therefore a Market-Profile-INFORMED structural screen using
// native TPO concepts (opening location, value acceptance/rejection, IB / range
// extension, trend-day, relative-volume conviction). True per-symbol TPO levels are
// obtained on demand from the chart via server.mjs -> confirmTPO (Stage 2).
//
// The scanner's "VWAP" column actually returns the typical/pivot price (H+L+C)/3, so
// it is surfaced honestly as "Pivot" — not claimed to be a volume-weighted VWAP.

const SCAN_URL = 'https://scanner.tradingview.com/india/scan';

// Columns we read (all verified present on the india scan). Order matters — the
// scanner returns values as a positional array per symbol.
const COLS = ['name', 'close', 'open', 'high', 'low', 'volume', 'VWAP',
  'relative_volume_10d_calc', 'change', 'gap', 'ATR', 'average_volume_10d_calc'];

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;

async function post(body) {
  const r = await fetch(SCAN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`scanner HTTP ${r.status}`);
  return r.json();
}

// Fetch NIFTY % change for index-alignment scoring. Degrades gracefully to null.
async function niftyChange() {
  try {
    const j = await post({ symbols: { tickers: ['NSE:NIFTY'] }, columns: ['change'] });
    const v = j?.data?.[0]?.d?.[0];
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}

// Fetch the full NSE primary-stock universe (one request).
async function universe() {
  const body = {
    filter: [
      { left: 'exchange', operation: 'equal', right: 'NSE' },
      { left: 'is_primary', operation: 'equal', right: true },
      { left: 'type', operation: 'equal', right: 'stock' },
    ],
    options: { lang: 'en' },
    columns: COLS,
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
    range: [0, 3500],
  };
  const j = await post(body);
  return (j.data || []).map(row => {
    const d = row.d; const o = {};
    COLS.forEach((c, i) => { o[c] = d[i]; });
    o.ticker = row.s; // e.g. "NSE:RELIANCE"
    return o;
  });
}

// Score one symbol. Returns a ranked opportunity or null if not a high-quality setup.
function evaluate(row, niftyChg, cfg) {
  const O = row.open, H = row.high, L = row.low, C = row.close;
  const pivot = row.VWAP;            // (H+L+C)/3 — labeled "Pivot", not VWAP
  const rVol = row.relative_volume_10d_calc;
  const chg = row.change, gap = row.gap, atr = row.ATR, avgVol = row.average_volume_10d_calc;
  if (![O, H, L, C, atr].every(v => typeof v === 'number' && isFinite(v))) return null;
  const range = H - L;
  if (range <= 0 || atr <= 0) return null;

  // Liquidity + price floor — keep illiquid penny names out (still full NSE universe).
  if (avgVol != null && avgVol < cfg.minAvgVol) return null;
  if (C < cfg.minPrice) return null;

  const pos = clamp((C - L) / range);          // 0=at low, 1=at high (value acceptance)
  const rangeATR = range / atr;                // day-range vs ATR (range extension)
  const driveUp = (C - O) / atr;               // initiative up
  const driveDn = (O - C) / atr;               // initiative down

  // Direction: only clean directional (initiative) setups qualify.
  let dir = 0;
  if (C > O && pos >= 0.55 && (chg ?? 0) > 0) dir = 1;
  else if (C < O && pos <= 0.45 && (chg ?? 0) < 0) dir = -1;
  if (!dir) return null;

  const long = dir === 1;

  // ---- score components (0..1 each, then weighted) --------------------------
  // 1) Opening location (gap aligned + open-drive)
  const gapAligned = (long ? (gap ?? 0) > 0 : (gap ?? 0) < 0);
  const loc = clamp((gapAligned ? 0.5 : 0) + 0.5 * clamp(long ? driveUp : driveDn));
  // 2) Value acceptance vs pivot + position in range
  const vsPivot = pivot != null ? clamp((long ? (C - pivot) : (pivot - C)) / atr) : 0.5;
  const acc = clamp(0.6 * (long ? pos : 1 - pos) + 0.4 * vsPivot);
  // 3) IB / range-extension trend-day proxy
  const ext = clamp((clamp(rangeATR / 1.6)) * (long ? pos : 1 - pos) * 1.15);
  // 4) Relative-volume conviction
  const vol = rVol != null ? clamp(rVol / 2) : 0.3;
  // 5) Index alignment
  const idx = niftyChg == null ? 0.5 : ((long ? niftyChg > 0 : niftyChg < 0) ? 1 : 0);

  // ---- entry / SL / targets (structural, intraday) --------------------------
  // Market-Profile style: enter on a pullback into value (pivot) rather than chasing
  // the extreme; stop beyond value (tighter of an ATR stop or the day extreme); targets
  // project range extension beyond the session high/low. R:R falls out of the geometry.
  const buf = 0.25 * atr;
  let entry, sl, t1, t2;
  if (long) {
    entry = (pivot != null && pivot < C) ? pivot : C;   // pullback to value, else market
    sl = Math.max(L, entry - atr) - buf;                 // tighter of ATR stop / day low
    t1 = H + 0.35 * range;                               // range-extension objective 1
    t2 = H + 0.75 * range;                               // range-extension objective 2
  } else {
    entry = (pivot != null && pivot > C) ? pivot : C;
    sl = Math.min(H, entry + atr) + buf;
    t1 = L - 0.35 * range;
    t2 = L - 0.75 * range;
  }
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  const rr = Math.abs(t1 - entry) / risk;

  // 6) R:R geometry
  const rrScore = clamp((rr - 1) / 1.5); // 1.0R->0, 2.5R->1

  const W = { loc: 20, acc: 20, ext: 15, vol: 15, idx: 10, rr: 20 };
  const score = Math.round(
    loc * W.loc + acc * W.acc + ext * W.ext + vol * W.vol + idx * W.idx + rrScore * W.rr
  );

  // Quality gate — only high-conviction, sane-geometry setups surface.
  if (score < cfg.minScore || rr < cfg.minRR || (rVol ?? 0) < cfg.minRVol) return null;

  const confidence = score >= 85 ? 'High' : score >= 75 ? 'Good' : 'Fair';

  // TPO-language reason from real structure.
  const dayType = rangeATR >= 1.4 && (long ? pos >= 0.75 : pos <= 0.25) ? 'trend-day'
    : rangeATR < 0.9 ? 'balanced/normal-day' : 'normal-day';
  const bits = [];
  bits.push(`Open-${long ? 'drive up' : 'drive down'} (gap ${gap >= 0 ? '+' : ''}${r2(gap)}%)`);
  bits.push(`accepting ${long ? 'upper' : 'lower'} value (${Math.round(pos * 100)}% of day range${pivot != null ? `, ${long ? 'above' : 'below'} pivot` : ''})`);
  bits.push(`range ${r2(rangeATR)}× ATR (${dayType})`);
  if (rVol != null) bits.push(`rVol ${r2(rVol)}×`);
  if (niftyChg != null) bits.push(idx ? 'aligned with NIFTY' : 'against NIFTY');
  const reason = bits.join(' · ');

  return {
    symbol: row.name,
    ticker: row.ticker,
    ltp: r2(C),
    signal: long ? 'LONG' : 'SHORT',
    entry: r2(entry),
    sl: r2(sl),
    targets: [r2(t1), r2(t2)],
    rr: r2(rr),
    score,
    confidence,
    reason,
    pos: Math.round(pos * 100),
    rVol: r2(rVol),
    changePct: r2(chg),
  };
}

// Stage 1 — scan the full NSE universe and return ranked high-quality setups.
export async function scanTPO(cfg = {}) {
  const conf = {
    minScore: cfg.minScore ?? 70,
    minRR: cfg.minRR ?? 1.5,
    minRVol: cfg.minRVol ?? 1.2,
    minAvgVol: cfg.minAvgVol ?? 50000,
    minPrice: cfg.minPrice ?? 20,
    top: cfg.top ?? 40,
  };
  const [rows, niftyChg] = await Promise.all([universe(), niftyChange()]);
  const out = [];
  for (const row of rows) {
    const r = evaluate(row, niftyChg, conf);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.score - a.score);
  return {
    ts: Date.now(),
    universe: rows.length,
    niftyChangePct: r2(niftyChg),
    count: out.length,
    rows: out.slice(0, conf.top),
    note: 'Server-side scanner data (real, typically ~15m delayed). Stage-1 profile-informed structural scan — use per-row Confirm for true on-chart levels.',
  };
}
