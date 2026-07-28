// lib/patterns.mjs — rule-based multi-timeframe pattern & stage analysis.
// ANALYSIS ONLY. Zero dependencies. Consumes the real OHLC series from lib/history.mjs.
//
// Philosophy (Weinstein + O'Neil + swing-trader confluence):
//   - Top-down. The Monthly/Weekly stage sets the PRIMARY trend; Daily gives the setup;
//     4H gives the trigger. A pattern that fights the higher timeframe is scored down.
//   - Objective, not narrative. Every pattern is detected from swing pivots, fitted
//     boundary lines, ATR-scaled tolerances, range geometry and volume — never prose.
//   - Only high-confidence output. Detections below MIN_CONFIDENCE are dropped, so an
//     empty pattern list is a legitimate (and honest) answer.
//
// Every detector returns { name, status, confidence, score, detail, levels } where
//   status     Developing | Confirmed | Failed
//   confidence 0–100, a weighted sum of the detector's own evidence terms
//   score      0–10 technical score = confidence, volume confirmation and higher-
//              timeframe alignment (alignment is applied in buildReport).

// Shared primitives live in lib/indicators.mjs so the VCP and Elliott engines compute
// from the same implementation (extracted from here, unchanged).
import { r2, clamp, sma, atr, pivots, lineFit, evidence, volRatio } from './indicators.mjs';

const MIN_CONFIDENCE = 55;      // below this a detection is not "high-confidence"
const TF_WEIGHT = { '1M': 0.35, '1W': 0.30, '1D': 0.25, '4H': 0.10 };
const TF_LABEL = { '1M': 'Monthly', '1W': 'Weekly', '1D': 'Daily', '4H': '4-Hour' };

// ---- Stage analysis (Weinstein, generalised to any timeframe) ---------------
// The 30-period MA is the stage line. Its slope decides advancing vs declining; the
// prior slope disambiguates a flat MA between basing (Stage 1) and topping (Stage 3).
export function stageOf(bars, A) {
  const closes = bars.map(b => b.c);
  const ma = sma(closes, 30);
  if (ma == null) return { stage: null, label: 'n/a', confidence: 0, reason: 'Need ≥30 bars for the 30-period stage MA.' };
  const maPrev = sma(closes, 30, bars.length - 6);
  const maOld = sma(closes, 30, bars.length - 21);
  const c = closes[closes.length - 1];
  const slope = maPrev ? (ma - maPrev) / maPrev * 100 : 0;        // % over 5 bars
  const priorSlope = maOld && maPrev ? (maPrev - maOld) / maOld * 100 : 0;
  const posATR = A ? (c - ma) / A : 0;                            // distance from MA in ATR
  const flat = Math.abs(slope) <= 0.75;
  const above = c > ma;
  const held = bars.slice(-10).filter(b => (above ? b.c > ma : b.c < ma)).length / 10;

  let stage, label, reason;
  if (!flat && slope > 0 && above) {
    stage = 2; label = 'Stage 2 — Advancing';
    reason = `Price ${r2(posATR)} ATR above a rising 30-MA (+${r2(slope)}%/5 bars).`;
  } else if (!flat && slope < 0 && !above) {
    stage = 4; label = 'Stage 4 — Declining';
    reason = `Price ${r2(Math.abs(posATR))} ATR below a falling 30-MA (${r2(slope)}%/5 bars).`;
  } else if (flat && priorSlope <= 0) {
    stage = 1; label = 'Stage 1 — Basing';
    reason = `30-MA flat (${r2(slope)}%/5 bars) after a declining phase — accumulation base.`;
  } else if (flat && priorSlope > 0) {
    stage = 3; label = 'Stage 3 — Topping';
    reason = `30-MA flattening (${r2(slope)}%/5 bars) after an advance — distribution risk.`;
  } else if (above) {
    stage = 3; label = 'Stage 3 — Topping';
    reason = `Price above a rolling-over 30-MA (${r2(slope)}%/5 bars) — late-cycle.`;
  } else {
    stage = 1; label = 'Stage 1 — Basing';
    reason = `Price below a turning-up 30-MA (${r2(slope)}%/5 bars) — early base.`;
  }
  const phase = Math.abs(posATR) < 1 ? 'early' : Math.abs(posATR) < 3 ? 'mid' : 'late';
  const confidence = evidence([
    [3, clamp(Math.abs(slope) / 2.5)],
    [3, held],
    [2, clamp(Math.abs(posATR) / 3)],
    [2, flat ? clamp(1 - Math.abs(slope) / 0.75) : 1],
  ]);
  return { stage, label, phase, confidence, reason, ma: r2(ma), maSlopePct: r2(slope), distATR: r2(posATR) };
}

// ---- market structure ------------------------------------------------------
function structureOf(pv) {
  const H = pv.highs.slice(-3), L = pv.lows.slice(-3);
  if (H.length < 2 || L.length < 2) return { label: 'Insufficient swings', dir: 0 };
  const hh = H[H.length - 1].p > H[H.length - 2].p, hl = L[L.length - 1].p > L[L.length - 2].p;
  if (hh && hl) return { label: 'Higher highs / higher lows', dir: 1 };
  if (!hh && !hl) return { label: 'Lower highs / lower lows', dir: -1 };
  if (hh && !hl) return { label: 'Higher highs / lower lows (broadening)', dir: 0 };
  return { label: 'Lower highs / higher lows (compression)', dir: 0 };
}

// =============================================================================
// Detectors. Each gets ctx = { bars, pv, A, c, vr, win } and returns a detection or null.
// =============================================================================

// -- Double Top / Double Bottom ----------------------------------------------
function dblTop({ bars, pv, A, c }) {
  const H = pv.highs.slice(-2);
  if (H.length < 2 || H[1].i - H[0].i < 5) return null;
  const diff = Math.abs(H[1].p - H[0].p);
  if (diff > 0.75 * A) return null;
  const trough = Math.min(...bars.slice(H[0].i, H[1].i + 1).map(b => b.l));
  const peak = Math.max(H[0].p, H[1].p);
  if (peak - trough < 1.5 * A) return null;
  const status = c < trough - 0.25 * A ? 'Confirmed' : c > peak + 0.25 * A ? 'Failed' : 'Developing';
  return {
    name: 'Double Top', bias: -1, status,
    confidence: evidence([[3, 1 - diff / (0.75 * A)], [2, clamp((peak - trough) / (3 * A))],
      [2, clamp((H[1].i - H[0].i) / 20)], [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.6]]),
    detail: `Twin highs ${r2(H[0].p)} / ${r2(H[1].p)} (${r2(diff / A)} ATR apart), neckline ${r2(trough)}.`,
    levels: { resistance: r2(peak), neckline: r2(trough), target: r2(trough - (peak - trough)) },
  };
}
function dblBottom({ bars, pv, A, c }) {
  const L = pv.lows.slice(-2);
  if (L.length < 2 || L[1].i - L[0].i < 5) return null;
  const diff = Math.abs(L[1].p - L[0].p);
  if (diff > 0.75 * A) return null;
  const peak = Math.max(...bars.slice(L[0].i, L[1].i + 1).map(b => b.h));
  const bottom = Math.min(L[0].p, L[1].p);
  if (peak - bottom < 1.5 * A) return null;
  const status = c > peak + 0.25 * A ? 'Confirmed' : c < bottom - 0.25 * A ? 'Failed' : 'Developing';
  return {
    name: 'Double Bottom', bias: 1, status,
    confidence: evidence([[3, 1 - diff / (0.75 * A)], [2, clamp((peak - bottom) / (3 * A))],
      [2, clamp((L[1].i - L[0].i) / 20)], [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.6]]),
    detail: `Twin lows ${r2(L[0].p)} / ${r2(L[1].p)} (${r2(diff / A)} ATR apart), neckline ${r2(peak)}.`,
    levels: { support: r2(bottom), neckline: r2(peak), target: r2(peak + (peak - bottom)) },
  };
}

// -- Head & Shoulders / Inverse ----------------------------------------------
function headShoulders({ bars, pv, A, c }) {
  const H = pv.highs.slice(-3);
  if (H.length < 3) return null;
  const [ls, hd, rs] = H;
  if (!(hd.p > ls.p + 0.5 * A && hd.p > rs.p + 0.5 * A)) return null;
  const asym = Math.abs(ls.p - rs.p);
  if (asym > 1.2 * A) return null;
  const n1 = Math.min(...bars.slice(ls.i, hd.i + 1).map(b => b.l));
  const n2 = Math.min(...bars.slice(hd.i, rs.i + 1).map(b => b.l));
  const neck = (n1 + n2) / 2;
  const status = c < neck - 0.25 * A ? 'Confirmed' : c > hd.p ? 'Failed' : 'Developing';
  return {
    name: 'Head & Shoulders', bias: -1, status,
    confidence: evidence([[3, 1 - asym / (1.2 * A)], [2, clamp((hd.p - Math.max(ls.p, rs.p)) / (2 * A))],
      [2, clamp((hd.p - neck) / (3 * A))], [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.6]]),
    detail: `Shoulders ${r2(ls.p)} / ${r2(rs.p)}, head ${r2(hd.p)}, neckline ${r2(neck)}.`,
    levels: { neckline: r2(neck), resistance: r2(hd.p), target: r2(neck - (hd.p - neck)) },
  };
}
function invHeadShoulders({ bars, pv, A, c }) {
  const L = pv.lows.slice(-3);
  if (L.length < 3) return null;
  const [ls, hd, rs] = L;
  if (!(hd.p < ls.p - 0.5 * A && hd.p < rs.p - 0.5 * A)) return null;
  const asym = Math.abs(ls.p - rs.p);
  if (asym > 1.2 * A) return null;
  const n1 = Math.max(...bars.slice(ls.i, hd.i + 1).map(b => b.h));
  const n2 = Math.max(...bars.slice(hd.i, rs.i + 1).map(b => b.h));
  const neck = (n1 + n2) / 2;
  const status = c > neck + 0.25 * A ? 'Confirmed' : c < hd.p ? 'Failed' : 'Developing';
  return {
    name: 'Inverse Head & Shoulders', bias: 1, status,
    confidence: evidence([[3, 1 - asym / (1.2 * A)], [2, clamp((Math.min(ls.p, rs.p) - hd.p) / (2 * A))],
      [2, clamp((neck - hd.p) / (3 * A))], [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.6]]),
    detail: `Shoulders ${r2(ls.p)} / ${r2(rs.p)}, head ${r2(hd.p)}, neckline ${r2(neck)}.`,
    levels: { neckline: r2(neck), support: r2(hd.p), target: r2(neck + (neck - hd.p)) },
  };
}

// -- Boundary-line family: rectangle, triangles, wedges, channel ---------------
// One geometry pass. The two fitted boundaries' slopes and their convergence decide
// which member of the family this is; everything is ATR-scaled so it ports across TFs.
function boundaryFamily({ bars, pv, A, c, win }) {
  const from = bars.length - win;
  const H = pv.highs.filter(p => p.i >= from).slice(-4), L = pv.lows.filter(p => p.i >= from).slice(-4);
  if (H.length < 2 || L.length < 2) return null;
  const fh = lineFit(H), fl = lineFit(L);
  if (!fh || !fl) return null;

  const i0 = Math.min(H[0].i, L[0].i), i1 = bars.length - 1;
  const wStart = fh.at(i0) - fl.at(i0), wEnd = fh.at(i1) - fl.at(i1);
  if (wEnd <= 0) return null;                                  // boundaries already crossed
  const conv = wEnd / (wStart || wEnd);                        // <1 converging, >1 diverging
  const flat = 0.10 * A;                                       // per-bar slope treated as flat
  const sH = fh.slope, sL = fl.slope;
  const upper = fh.at(i1), lower = fl.at(i1);
  const fitQ = (fh.r2 + fl.r2) / 2;
  const touches = H.length + L.length;

  let name = null, bias = 0;
  if (Math.abs(sH) < flat && Math.abs(sL) < flat) { name = 'Rectangle'; bias = 0; }
  else if (Math.abs(sH) < flat && sL > flat) { name = 'Ascending Triangle'; bias = 1; }
  else if (Math.abs(sL) < flat && sH < -flat) { name = 'Descending Triangle'; bias = -1; }
  else if (sH < -flat && sL > flat) { name = 'Symmetrical Triangle'; bias = 0; }
  else if (sH > flat && sL > flat) { name = conv < 0.8 ? 'Rising Wedge' : 'Ascending Channel'; bias = conv < 0.8 ? -1 : 1; }
  else if (sH < -flat && sL < -flat) { name = conv < 0.8 ? 'Falling Wedge' : 'Descending Channel'; bias = conv < 0.8 ? 1 : -1; }
  if (!name) return null;
  // Triangles/wedges must actually be converging; channels must actually be parallel.
  if (/Triangle|Wedge/.test(name) && conv > 0.85) return null;
  if (/Channel/.test(name) && (conv < 0.75 || conv > 1.35)) return null;
  if (name === 'Rectangle' && (wEnd < 1.2 * A || conv < 0.7 || conv > 1.4)) return null;

  const status = c > upper + 0.25 * A ? (bias >= 0 ? 'Confirmed' : 'Failed')
    : c < lower - 0.25 * A ? (bias <= 0 ? 'Confirmed' : 'Failed')
      : 'Developing';
  return {
    name, bias, status,
    confidence: evidence([[3, fitQ], [3, clamp((touches - 4) / 4 + 0.5)],
      [2, clamp(win / 40)], [2, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.25 : 0.65]]),
    detail: `${touches} boundary touches over ${i1 - i0 + 1} bars · resistance ${r2(upper)} / support ${r2(lower)} · `
      + `width ${r2(wEnd / A)} ATR (${conv < 0.85 ? 'converging' : conv > 1.15 ? 'expanding' : 'parallel'}) · fit R² ${r2(fitQ)}.`,
    levels: { resistance: r2(upper), support: r2(lower), target: r2(bias >= 0 ? upper + wStart : lower - wStart) },
  };
}

// -- Flag / Pennant ----------------------------------------------------------
// Pole = a ≥2.5-ATR impulse in ≤12 bars; consolidation = a shallow counter-drift after it.
function flagPennant({ bars, A, c }) {
  const n = bars.length;
  for (let cons = 3; cons <= 18; cons++) {
    const p = n - 1 - cons;                                    // last bar of the pole
    if (p < 12) break;
    for (let len = 4; len <= 12; len++) {
      const s = p - len;
      if (s < 0) continue;
      const move = bars[p].c - bars[s].c;
      if (Math.abs(move) < 2.5 * A) continue;
      const long = move > 0;
      const seg = bars.slice(p + 1);
      const segHi = Math.max(...seg.map(b => b.h)), segLo = Math.min(...seg.map(b => b.l));
      const retr = long ? (bars[p].c - segLo) / move : (segHi - bars[p].c) / -move;
      if (!(retr > 0 && retr <= 0.5)) continue;                // deep retrace = not a flag
      const poleVol = sma(bars.slice(s, p + 1).map(b => b.v || 0), p - s + 1);
      const consVol = sma(seg.map(b => b.v || 0), seg.length);
      const drying = poleVol && consVol ? clamp(1 - consVol / poleVol) : 0.4;
      const range = segHi - segLo;
      const half = Math.ceil(seg.length / 2);
      const r1 = Math.max(...seg.slice(0, half).map(b => b.h)) - Math.min(...seg.slice(0, half).map(b => b.l));
      const r2b = Math.max(...seg.slice(half).map(b => b.h)) - Math.min(...seg.slice(half).map(b => b.l));
      const pennant = r2b < 0.7 * r1;
      const name = pennant ? 'Pennant' : (long ? 'Bull Flag' : 'Bear Flag');
      const brk = long ? segHi : segLo;
      const status = (long ? c > brk + 0.25 * A : c < brk - 0.25 * A) ? 'Confirmed'
        : (long ? c < segLo - 0.25 * A : c > segHi + 0.25 * A) ? 'Failed' : 'Developing';
      return {
        name, bias: long ? 1 : -1, status,
        confidence: evidence([[3, clamp(Math.abs(move) / A / 5)], [2, 1 - retr / 0.5],
          [2, drying], [2, clamp(range / A / 3 > 1 ? 0.3 : 1)],
          [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.65]]),
        detail: `Pole ${r2(Math.abs(move) / A)} ATR in ${len} bars, ${cons}-bar ${pennant ? 'converging' : 'parallel'} `
          + `consolidation retracing ${Math.round(retr * 100)}% on ${drying > 0.3 ? 'declining' : 'steady'} volume.`,
        levels: { trigger: r2(brk), support: r2(segLo), resistance: r2(segHi), target: r2(long ? brk + Math.abs(move) : brk - Math.abs(move)) },
      };
    }
  }
  return null;
}

// -- Cup & Handle ------------------------------------------------------------
function cupHandle({ bars, A, c }) {
  const win = Math.min(bars.length, 70);
  if (win < 30) return null;
  const w = bars.slice(-win);
  const lRim = Math.max(...w.slice(0, Math.floor(win * 0.2)).map(b => b.h));
  let lo = Infinity, loI = 0;
  w.forEach((b, i) => { if (b.l < lo) { lo = b.l; loI = i; } });
  const depth = (lRim - lo) / lRim;
  if (!(depth >= 0.12 && depth <= 0.55)) return null;
  if (loI < win * 0.3 || loI > win * 0.7) return null;          // low must sit mid-window (rounded)
  const right = w.slice(Math.floor(win * 0.65));
  const rRim = Math.max(...right.map(b => b.h));
  if (rRim < lRim * 0.92) return null;                          // never recovered the left rim
  const handle = w.slice(-Math.min(15, Math.floor(win * 0.2)));
  const hLo = Math.min(...handle.map(b => b.l));
  const hDepth = (rRim - hLo) / (lRim - lo);
  if (hDepth > 0.5) return null;                                // too deep to be a handle
  const status = c > rRim + 0.25 * A ? 'Confirmed' : c < hLo - 0.5 * A ? 'Failed' : 'Developing';
  return {
    name: 'Cup & Handle', bias: 1, status,
    confidence: evidence([[3, clamp(1 - Math.abs(depth - 0.3) / 0.3)], [2, clamp(1 - Math.abs(loI / win - 0.5) / 0.2)],
      [2, clamp(rRim / lRim)], [2, clamp(1 - hDepth / 0.5)],
      [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.65]]),
    detail: `Cup ${Math.round(depth * 100)}% deep over ${win} bars (low at ${Math.round(loI / win * 100)}% of base), `
      + `rims ${r2(lRim)} / ${r2(rRim)}, handle ${Math.round(hDepth * 100)}% of cup depth.`,
    levels: { pivot: r2(rRim), support: r2(hLo), target: r2(rRim + (lRim - lo)) },
  };
}

// -- VCP (O'Neil / Minervini volatility contraction) --------------------------
function vcp({ bars, pv, A, c }) {
  const H = pv.highs.slice(-4), L = pv.lows.slice(-4);
  if (H.length < 3 || L.length < 3) return null;
  // Pair each swing high with the next swing low to measure successive pullback depths.
  const legs = [];
  for (const h of H) {
    const l = L.find(x => x.i > h.i);
    if (l) legs.push({ from: h.p, to: l.p, depth: (h.p - l.p) / h.p, i: l.i });
  }
  if (legs.length < 3) return null;
  const last3 = legs.slice(-3);
  if (!(last3[0].depth > last3[1].depth && last3[1].depth > last3[2].depth)) return null;
  if (last3[2].depth > 0.85 * last3[1].depth) return null;      // each contraction must be a real step tighter
  const pivot = Math.max(...H.slice(-2).map(x => x.p));
  const early = sma(bars.slice(last3[0].i - 5, last3[0].i + 5).map(b => b.v || 0), 10);
  const late = sma(bars.slice(-10).map(b => b.v || 0), 10);
  const dry = early && late ? clamp(1 - late / early) : 0.4;
  const status = c > pivot + 0.25 * A ? 'Confirmed' : c < last3[2].to - 0.5 * A ? 'Failed' : 'Developing';
  return {
    name: 'VCP', bias: 1, status,
    confidence: evidence([[3, clamp(1 - last3[2].depth / last3[0].depth)], [2, dry],
      [2, clamp(last3[0].depth / 0.25)], [3, status === 'Confirmed' ? 1 : status === 'Failed' ? 0.2 : 0.7]]),
    detail: `Contractions ${last3.map(x => Math.round(x.depth * 100) + '%').join(' → ')} into pivot ${r2(pivot)}; `
      + `volume ${dry > 0.25 ? 'drying up' : 'flat'} through the base.`,
    levels: { pivot: r2(pivot), support: r2(last3[2].to), target: r2(pivot * (1 + last3[0].depth)) },
  };
}

// -- Breakout / Breakdown / Breakout Retest -----------------------------------
function breakLevels({ bars, A, c, vr }) {
  const n = bars.length, look = 20;
  if (n < look + 3) return null;
  const prior = bars.slice(n - 1 - look, n - 1);
  const hh = Math.max(...prior.map(b => b.h)), ll = Math.min(...prior.map(b => b.l));
  const out = [];
  if (c > hh) {
    out.push({
      name: 'Breakout', bias: 1, status: vr != null && vr >= 1.3 ? 'Confirmed' : 'Developing',
      confidence: evidence([[3, clamp((c - hh) / A)], [3, clamp((vr ?? 1) / 2)], [2, 1], [2, clamp(look / 20)]]),
      detail: `Close ${r2(c)} above the ${look}-bar high ${r2(hh)} (${r2((c - hh) / A)} ATR) on ${vr ? r2(vr) + '×' : 'unknown'} average volume.`,
      levels: { level: r2(hh), support: r2(hh), target: r2(c + (hh - ll)) },
    });
  } else if (c < ll) {
    out.push({
      name: 'Breakdown', bias: -1, status: vr != null && vr >= 1.3 ? 'Confirmed' : 'Developing',
      confidence: evidence([[3, clamp((ll - c) / A)], [3, clamp((vr ?? 1) / 2)], [2, 1], [2, clamp(look / 20)]]),
      detail: `Close ${r2(c)} below the ${look}-bar low ${r2(ll)} (${r2((ll - c) / A)} ATR) on ${vr ? r2(vr) + '×' : 'unknown'} average volume.`,
      levels: { level: r2(ll), resistance: r2(ll), target: r2(c - (hh - ll)) },
    });
  }
  // Retest: a break happened in the last 12 bars and price has returned to that level.
  for (let back = 2; back <= 12; back++) {
    const j = n - 1 - back;
    if (j - look < 0) break;
    const w = bars.slice(j - look, j);
    const lvl = Math.max(...w.map(b => b.h));
    const lvlLo = Math.min(...w.map(b => b.l));
    if (bars[j].c > lvl && Math.abs(c - lvl) <= 0.75 * A) {
      out.push({
        name: 'Breakout Retest', bias: 1, status: c >= lvl ? 'Confirmed' : c < lvl - 0.75 * A ? 'Failed' : 'Developing',
        confidence: evidence([[3, 1 - Math.abs(c - lvl) / (0.75 * A)], [2, clamp(1 - back / 12)],
          [3, c >= lvl ? 1 : 0.3], [2, clamp((vr ?? 1) / 1.5)]]),
        detail: `Broke ${r2(lvl)} ${back} bars ago and has returned to it — price ${c >= lvl ? 'holding above' : 'back below'} the level.`,
        levels: { level: r2(lvl), support: r2(lvl), target: r2(lvl + (lvl - lvlLo)) },
      });
      break;
    }
    if (bars[j].c < lvlLo && Math.abs(c - lvlLo) <= 0.75 * A) {
      out.push({
        name: 'Breakdown Retest', bias: -1, status: c <= lvlLo ? 'Confirmed' : c > lvlLo + 0.75 * A ? 'Failed' : 'Developing',
        confidence: evidence([[3, 1 - Math.abs(c - lvlLo) / (0.75 * A)], [2, clamp(1 - back / 12)],
          [3, c <= lvlLo ? 1 : 0.3], [2, clamp((vr ?? 1) / 1.5)]]),
        detail: `Broke ${r2(lvlLo)} ${back} bars ago and has rallied back to it — price ${c <= lvlLo ? 'rejected below' : 'reclaiming'} the level.`,
        levels: { level: r2(lvlLo), resistance: r2(lvlLo), target: r2(lvlLo - (lvl - lvlLo)) },
      });
      break;
    }
  }
  return out.length ? out : null;
}

// -- Trend continuation / reversal -------------------------------------------
function trendState({ bars, pv, A, c, struct, stage }) {
  const closes = bars.map(b => b.c);
  const f = sma(closes, 20), s = sma(closes, 50);
  if (f == null || s == null) return null;
  const stacked = f > s ? 1 : -1;
  const aligned = struct.dir !== 0 && struct.dir === stacked;
  if (aligned) {
    const bias = stacked;
    return {
      name: 'Trend Continuation', bias,
      status: (bias > 0 ? c > f : c < f) ? 'Confirmed' : 'Developing',
      confidence: evidence([[3, 1], [3, clamp(Math.abs(f - s) / A / 2)],
        [2, clamp(Math.abs(c - s) / A / 3)], [2, stage?.stage === (bias > 0 ? 2 : 4) ? 1 : 0.4]]),
      detail: `${struct.label} with the 20-MA ${bias > 0 ? 'above' : 'below'} the 50-MA (${r2(f)} vs ${r2(s)}) — trend intact.`,
      levels: { support: r2(bias > 0 ? Math.min(f, s) : null), resistance: r2(bias > 0 ? null : Math.max(f, s)) },
    };
  }
  // Structure fighting the MA stack = the trend is being challenged.
  if (struct.dir !== 0 && struct.dir !== stacked) {
    const bias = struct.dir;
    return {
      name: 'Trend Reversal', bias,
      status: (bias > 0 ? c > s : c < s) ? 'Confirmed' : 'Developing',
      confidence: evidence([[3, 0.8], [2, clamp(Math.abs(c - s) / A / 2)],
        [2, clamp(Math.abs(f - s) / A)], [3, (bias > 0 ? c > f && c > s : c < f && c < s) ? 1 : 0.45]]),
      detail: `${struct.label} against a ${stacked > 0 ? 'bullish' : 'bearish'} 20/50-MA stack — structure has turned ${bias > 0 ? 'up' : 'down'}.`,
      levels: { pivot: r2(s) },
    };
  }
  return null;
}

const DETECTORS = [dblTop, dblBottom, headShoulders, invHeadShoulders, boundaryFamily,
  flagPennant, cupHandle, vcp, breakLevels];

// ---- per-timeframe analysis -------------------------------------------------
export function analyzeTF(bars, tf) {
  const need = 35;
  if (!bars || bars.length < need) {
    return { tf, label: TF_LABEL[tf] || tf, ok: false, error: `Only ${bars?.length || 0} bars — need ≥${need}.`, patterns: [] };
  }
  const win = Math.min(bars.length, tf === '1M' ? 48 : tf === '1W' ? 80 : 120);
  const w = bars.slice(-win);
  const A = atr(w, 14) || (w[w.length - 1].c * 0.02);
  const pv = pivots(w, 2);
  const c = w[w.length - 1].c;
  const vr = volRatio(w, 20);
  const struct = structureOf(pv);
  const stage = stageOf(bars, A);
  const ctx = { bars: w, pv, A, c, vr, win, struct, stage };

  const found = [];
  for (const d of DETECTORS) {
    const r = d(ctx);
    if (!r) continue;
    (Array.isArray(r) ? r : [r]).forEach(x => found.push(x));
  }
  const t = trendState(ctx);
  if (t) found.push(t);

  const closes = bars.map(b => b.c);
  const patterns = found
    .filter(p => p.confidence >= MIN_CONFIDENCE)
    .map(p => ({ ...p, tf, score: r2(clamp(p.confidence / 10 + (p.status === 'Confirmed' ? 0.7 : p.status === 'Failed' ? -1.5 : 0), 0, 10)) }))
    .sort((a, b) => b.confidence - a.confidence);

  // Directional read for this timeframe: stage + structure + MA position, in [-1, 1].
  const stageDir = { 2: 1, 1: 0.25, 3: -0.25, 4: -1 }[stage.stage] ?? 0;
  const maDir = stage.ma != null ? clamp((c - stage.ma) / (2 * A), -1, 1) : 0;
  const patDir = patterns.length
    ? clamp(patterns.slice(0, 3).reduce((s, p) => s + p.bias * (p.confidence / 100) * (p.status === 'Confirmed' ? 1 : p.status === 'Failed' ? -0.5 : 0.6), 0) / 2, -1, 1)
    : 0;
  const dir = clamp(0.4 * stageDir + 0.2 * struct.dir + 0.2 * maDir + 0.2 * patDir, -1, 1);

  return {
    tf, label: TF_LABEL[tf] || tf, ok: true, bars: bars.length,
    close: r2(c), atr: r2(A), atrPct: r2(100 * A / c),
    changePct: r2(100 * (c / w[Math.max(0, w.length - 21)].c - 1)),
    ma20: r2(sma(closes, 20)), ma50: r2(sma(closes, 50)), ma200: r2(sma(closes, 200)),
    rvol: r2(vr), structure: struct, stage, dir: r2(dir),
    patterns,
    pivotHighs: pv.highs.slice(-4).map(p => r2(p.p)),
    pivotLows: pv.lows.slice(-4).map(p => r2(p.p)),
  };
}

// ---- support / resistance confluence ---------------------------------------
// Levels from every timeframe, weighted by timeframe importance and touch count, then
// clustered within 0.6 daily ATR. Higher-timeframe levels dominate, as they should.
function keyLevels(tfs, price, dayATR) {
  const raw = [];
  const push = (p, w, src) => { if (p != null && isFinite(p) && p > 0) raw.push({ p, w, src }); };
  for (const a of Object.values(tfs)) {
    if (!a.ok) continue;
    const tw = { '1M': 4, '1W': 3, '1D': 2, '4H': 1 }[a.tf] || 1;
    a.pivotHighs.forEach(p => push(p, tw, `${a.label} swing high`));
    a.pivotLows.forEach(p => push(p, tw, `${a.label} swing low`));
    push(a.stage.ma, tw * 1.2, `${a.label} 30-MA (stage line)`);
    push(a.ma50, tw * 0.8, `${a.label} 50-MA`);
    push(a.ma200, tw * 1.0, `${a.label} 200-MA`);
    a.patterns.forEach(pt => Object.entries(pt.levels || {}).forEach(([k, v]) => {
      if (k !== 'target') push(v, tw * 1.1, `${a.label} ${pt.name} ${k}`);
    }));
  }
  const tol = 0.6 * (dayATR || price * 0.02);
  const clusters = [];
  raw.sort((a, b) => a.p - b.p);
  for (const r of raw) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(r.p - last.price) <= tol) {
      last.w += r.w; last.srcs.push(r.src);
      last.price = (last.price * (last.n) + r.p) / (last.n + 1); last.n++;
    } else clusters.push({ price: r.p, w: r.w, n: 1, srcs: [r.src] });
  }
  const fmt = cl => ({
    price: r2(cl.price), strength: Math.min(10, r2(cl.w)), touches: cl.n,
    distPct: r2(100 * (cl.price - price) / price),
    sources: [...new Set(cl.srcs)].slice(0, 4),
  });
  return {
    support: clusters.filter(c => c.price < price).sort((a, b) => (b.price - a.price)).slice(0, 8)
      .sort((a, b) => b.w - a.w).slice(0, 4).map(fmt).sort((a, b) => b.price - a.price),
    resistance: clusters.filter(c => c.price > price).sort((a, b) => (a.price - b.price)).slice(0, 8)
      .sort((a, b) => b.w - a.w).slice(0, 4).map(fmt).sort((a, b) => a.price - b.price),
  };
}

// ---- report ----------------------------------------------------------------
const biasLabel = x => x >= 0.45 ? 'Strong Bullish' : x >= 0.15 ? 'Bullish'
  : x <= -0.45 ? 'Strong Bearish' : x <= -0.15 ? 'Bearish' : 'Neutral';

// Builds the full top-down report from the history payload produced by lib/history.mjs.
export function buildReport(series) {
  const order = ['1M', '1W', '1D', '4H'];                 // top-down, deliberately
  const tfs = {};
  for (const tf of order) {
    const s = series.tfs?.[tf];
    tfs[tf] = s?.ok ? analyzeTF(s.bars, tf) : { tf, label: TF_LABEL[tf], ok: false, error: s?.error || 'No data.', patterns: [] };
  }

  // Composite bias — higher timeframes carry more weight; missing TFs renormalise.
  let wsum = 0, dsum = 0;
  for (const tf of order) if (tfs[tf].ok) { wsum += TF_WEIGHT[tf]; dsum += TF_WEIGHT[tf] * tfs[tf].dir; }
  const composite = wsum ? r2(dsum / wsum) : 0;
  const dirs = order.filter(tf => tfs[tf].ok).map(tf => Math.sign(tfs[tf].dir));
  const aligned = dirs.length >= 2 && dirs.every(d => d === dirs[0] && d !== 0);

  // Higher-timeframe alignment adjusts each pattern's technical score (±1), because a
  // Daily bull flag inside a Weekly Stage 4 is not the same trade as one in Stage 2.
  const htf = { '1M': 0, '1W': tfs['1M'].ok ? tfs['1M'].dir : 0,
    '1D': (tfs['1W'].ok ? tfs['1W'].dir : 0), '4H': (tfs['1D'].ok ? tfs['1D'].dir : 0) };
  const all = [];
  for (const tf of order) {
    for (const p of tfs[tf].patterns) {
      const adj = clamp(p.bias * htf[tf], -1, 1);
      p.score = r2(clamp(p.score + adj, 0, 10));
      p.htfAligned = adj > 0.15 ? 'yes' : adj < -0.15 ? 'no' : 'neutral';
      all.push(p);
    }
  }
  all.sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  const price = tfs['1D'].ok ? tfs['1D'].close : (tfs['4H'].ok ? tfs['4H'].close : null);
  const dayATR = tfs['1D'].ok ? tfs['1D'].atr : null;
  const levels = price ? keyLevels(tfs, price, dayATR) : { support: [], resistance: [] };

  // Conclusion — assembled from the facts above, no narrative invention.
  const lead = all.find(p => p.status !== 'Failed') || null;
  const nearS = levels.support[0], nearR = levels.resistance[0];
  const conclusion = [];
  conclusion.push(`Composite bias ${biasLabel(composite)} (${composite >= 0 ? '+' : ''}${composite}) across `
    + order.filter(tf => tfs[tf].ok).map(tf => `${tfs[tf].label} ${tfs[tf].stage.label.split('—')[0].trim()}`).join(', ') + '.');
  conclusion.push(aligned ? 'All available timeframes agree — this is a confluence setup, not a single-chart read.'
    : 'Timeframes disagree — size down and defer to the higher timeframe until they converge.');
  if (lead) conclusion.push(`Lead pattern: ${lead.label || TF_LABEL[lead.tf]} ${lead.name} — ${lead.status}, `
    + `${lead.confidence}% confidence, ${lead.score}/10${lead.levels?.target != null ? `, measured objective ${lead.levels.target}` : ''}.`);
  else conclusion.push('No pattern clears the high-confidence bar right now — stand aside until structure forms.');
  if (nearR) conclusion.push(`Nearest resistance ${nearR.price} (${nearR.distPct > 0 ? '+' : ''}${nearR.distPct}%); `
    + `nearest support ${nearS ? `${nearS.price} (${nearS.distPct}%)` : 'none within the analysed range'}.`);
  if (price && dayATR) conclusion.push(`Daily ATR ${dayATR} (${tfs['1D'].atrPct}%) — size stops beyond that, not inside it.`);

  return {
    ok: true, ts: Date.now(), symbol: series.symbol, market: series.market, source: series.source,
    price, dayATR,
    overall: {
      bias: biasLabel(composite), composite, aligned,
      confidence: Math.round(100 * clamp(Math.abs(composite) * (aligned ? 1 : 0.7))),
      timeframesUsed: order.filter(tf => tfs[tf].ok).map(tf => tfs[tf].label),
      timeframesMissing: order.filter(tf => !tfs[tf].ok).map(tf => `${TF_LABEL[tf]}: ${tfs[tf].error}`),
    },
    timeframes: order.map(tf => tfs[tf]),
    stages: order.filter(tf => tfs[tf].ok).map(tf => ({
      tf: tfs[tf].label, ...tfs[tf].stage, structure: tfs[tf].structure.label,
    })),
    patterns: all.map(p => ({
      timeframe: TF_LABEL[p.tf], pattern: p.name, bias: p.bias > 0 ? 'Bullish' : p.bias < 0 ? 'Bearish' : 'Neutral',
      status: p.status, confidence: p.confidence, score: p.score, htfAligned: p.htfAligned,
      detail: p.detail, levels: p.levels,
    })),
    levels,
    conclusion,
  };
}

export { MIN_CONFIDENCE };
