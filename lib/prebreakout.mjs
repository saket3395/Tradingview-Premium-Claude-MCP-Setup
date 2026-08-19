// lib/prebreakout.mjs — multi-factor pre-breakout qualification. ANALYSIS ONLY, zero deps.
//
// WHY THIS EXISTS. The breakout scanners used to rank a candidate purely by its detector's
// own confidence and its distance to the pivot. Distance is not readiness: a symbol can sit
// 1% under a level while chopping, expanding in volatility, on no volume — that is a false
// pre-breakout, and ranking it next to a genuinely coiled base is exactly the noise this
// dashboard is supposed to avoid. This module scores the confluence institutional traders
// actually look for BEFORE a breakout, from real bars only, and sorts each candidate into
// one honest lifecycle stage:
//
//   WATCH                    — passes the base gates but a pillar is still developing.
//   HIGH-CONFIDENCE PRE-BREAKOUT — coiled and aligned, close under the level, ready to go.
//   CONFIRMED BREAKOUT       — already cleared the level on a volume-expansion, strong close.
//
// It NEVER invents data or probabilities. Every factor is derived from the OHLC bars that
// lib/history.mjs already fetched, reusing lib/indicators.mjs — no new inputs, no new deps.
// Where a factor cannot be computed (too few bars, no volume), it reports that honestly and
// the pillar simply does not fire.

import { r2, clamp, atr, sma, volRatio, slopePct } from './indicators.mjs';

// Defaults are daily-oriented (the breakout tabs default to 1D). They are deliberately
// strict — the whole point is fewer, cleaner candidates — and every one is overridable
// from config/markets.json → breakouts.prebreakout.
export const PREBREAKOUT_DEFAULTS = {
  look: 20,            // consolidation window (bars) used for range / accumulation
  tightMaxPct: 12,     // base range as % of price to still count as a tight consolidation
  contractRatio: 0.9,  // ATR(recent) / ATR(prior) at or below this = volatility contracting
  dryUpMax: 0.95,      // recent avg volume / 50-bar avg at or below this = supply drying up
  accMinPct: 52,       // up-volume share (%) at or above this = accumulation over the base
  minPerf6M: 0,        // 6-month performance floor for the relative-strength proxy
  rsStrong: 70,        // true RS percentile at or above this counts as strong
  nearDistPct: 3,      // must be within this % of the pivot to be a PRE-BREAKOUT (not just watching)
  extendedATR: 4.5,    // close this many ATRs above the 20-MA = extended → reject (chase risk)
  climaxPct: 14,       // a 5-bar surge beyond this % into resistance = climax → reject
  maxAtrPct: 9,        // ATR% above this WITHOUT contraction = too wide / noisy → reject
  confirmVol: 1.4,     // breakout bar's volume vs its 20-bar average to confirm a breakout
  confirmClosePos: 0.6,// breakout bar must close in the top (1-this) of its range
  highScore: 68,       // readinessScore at or above this (+ all pillars) = HIGH-CONFIDENCE
  weights: { prox: 0.20, tight: 0.20, vcontract: 0.15, vol: 0.20, trend: 0.15, rs: 0.10 },
};

// Average true range over a short slice, using the slice's own length (the shared atr()
// wants n+1 bars for n=14, which the ~10-bar sub-windows here do not have).
function shortATR(bars) {
  const n = bars.length - 1;
  if (n < 2) return null;
  let s = 0;
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1];
    s += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - p.c), Math.abs(bars[i].l - p.c));
  }
  return s / n;
}

const rangeOf = bars => {
  let hi = -Infinity, lo = Infinity;
  for (const b of bars) { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; }
  return { hi, lo, width: hi - lo };
};

// qualifyPreBreakout — the whole model. Pure: same inputs → same output.
//   bars   real OHLC {t,o,h,l,c,v} oldest-first (lib/history.mjs shape)
//   level  the price that must be cleared (pivot / trigger / neckline / wave extreme)
//   close  last close (defaults to the last bar)
//   atrVal precomputed ATR(14) if the caller already has it (else computed)
//   perf6M 6-month % performance from the Stage-1 scan (relative-strength proxy)
//   rs     true RS percentile 0..100 where the engine has it (VCP); else null
//   levelLabel  what the level is ('pivot' / 'resistance' …) for the reason text
//   cfg    overrides merged over PREBREAKOUT_DEFAULTS
// Returns { ok, tier, readinessScore, cleared, confirmed, distPct, factors[], reasons[], reject }.
export function qualifyPreBreakout({ bars, level, close, atrVal, perf6M = null, rs = null, levelLabel = 'pivot', cfg = {} } = {}) {
  const D = { ...PREBREAKOUT_DEFAULTS, ...cfg, weights: { ...PREBREAKOUT_DEFAULTS.weights, ...(cfg.weights || {}) } };
  const n = bars?.length || 0;
  if (n < 30 || !(level > 0)) return { ok: false, reject: 'insufficient bars for a pre-breakout read', tier: null, reasons: [] };

  const closes = bars.map(b => b.c);
  const vols = bars.map(b => b.v || 0);
  const c = close ?? closes[n - 1];
  const A = atrVal ?? atr(bars, 14) ?? c * 0.02;
  const dist = (level - c) / c * 100;          // >0 still below the level, <=0 cleared
  const cleared = dist <= 0;

  const ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);

  // ---- factor 1: range compression / tight base ----------------------------
  const look = Math.min(D.look, n - 1);
  const W = bars.slice(-look);
  const { width } = rangeOf(W);
  const rangePct = 100 * width / c;
  const half = Math.floor(look / 2);
  const r1 = rangeOf(W.slice(0, half)).width, r2w = rangeOf(W.slice(-half)).width;
  const narrowing = r2w <= r1;                          // second half no wider than first
  const broadening = r1 > 0 && r2w > 1.4 * r1;          // range clearly expanding = no coil
  const tightPass = rangePct <= D.tightMaxPct && narrowing;
  const tightScore = clamp(1 - rangePct / D.tightMaxPct);

  // ---- factor 2: volatility contraction ------------------------------------
  const k = Math.max(6, Math.floor(look / 2));
  const atrRecent = shortATR(bars.slice(-k)), atrPrior = shortATR(bars.slice(-2 * k, -k));
  const contractRatio = (atrRecent != null && atrPrior) ? atrRecent / atrPrior : null;
  const vcontractPass = contractRatio != null && contractRatio <= D.contractRatio;
  const vcontractScore = contractRatio == null ? 0.3 : clamp((1.1 - contractRatio) / 0.4);

  // ---- factor 3: volume dry-up + accumulation ------------------------------
  const recentVol = sma(vols, Math.min(10, look));
  const baseVol = sma(vols, Math.min(50, n));
  const dryUp = (recentVol != null && baseVol) ? recentVol / baseVol : null;
  let upVol = 0, dnVol = 0;
  for (let i = n - look; i < n; i++) { if (i <= 0) continue; (closes[i] >= closes[i - 1] ? (upVol += vols[i]) : (dnVol += vols[i])); }
  const upShare = (upVol + dnVol) ? 100 * upVol / (upVol + dnVol) : null;
  const dryPass = dryUp != null && dryUp <= D.dryUpMax;
  const accPass = upShare != null && upShare >= D.accMinPct;
  const volPass = dryPass || accPass;
  const dryScore = dryUp == null ? 0.3 : clamp((1.15 - dryUp) / 0.5);
  const accScore = upShare == null ? 0.3 : clamp((upShare - 45) / 20);
  const volScore = 0.5 * dryScore + 0.5 * accScore;

  // ---- factor 4: trend alignment -------------------------------------------
  const ma50Now = sma(closes, 50, n - 1), ma50Prev = sma(closes, 50, Math.max(0, n - 21));
  const trendPillars = [
    ma20 != null && c > ma20,
    ma20 != null && ma50 != null && ma20 > ma50,
    ma50 != null && ma200 != null && ma50 > ma200,
    ma50Now != null && ma50Prev != null && ma50Now > ma50Prev,
  ];
  const trendCount = trendPillars.filter(Boolean).length;
  const trendScore = trendCount / 4;
  const trendPass = trendCount >= 3;

  // ---- factor 5: relative strength / momentum ------------------------------
  let rsScore, rsPass, rsReason;
  if (rs != null) { rsScore = clamp(rs / 100); rsPass = rs >= D.rsStrong; rsReason = `RS ${rs}`; }
  else if (perf6M != null) { rsScore = clamp(perf6M / 30); rsPass = perf6M > D.minPerf6M; rsReason = `6M ${perf6M > 0 ? '+' : ''}${r2(perf6M)}%`; }
  else { rsScore = 0.3; rsPass = false; rsReason = null; }

  // ---- proximity -----------------------------------------------------------
  const proxScore = clamp(1 - Math.max(0, dist) / (D.nearDistPct * 2));
  const proxPass = dist <= D.nearDistPct;

  // ---- breakout confirmation ----------------------------------------------
  const last = bars[n - 1];
  const barRange = last.h - last.l;
  const closePos = barRange > 0 ? (last.c - last.l) / barRange : 1;
  const lastVolRatio = volRatio(bars, 20);
  const confirmed = cleared && lastVolRatio != null && lastVolRatio >= D.confirmVol && closePos >= D.confirmClosePos;

  // ---- extension / noise (context for both rejects and scoring) -----------
  const extAtr = (ma20 != null && A) ? (c - ma20) / A : 0;
  const atrPct = 100 * A / c;
  const surge5 = n > 6 && closes[n - 6] ? (c / closes[n - 6] - 1) * 100 : 0;

  const readinessScore = Math.round(100 * (
    D.weights.prox * proxScore + D.weights.tight * tightScore + D.weights.vcontract * vcontractScore
    + D.weights.vol * volScore + D.weights.trend * trendScore + D.weights.rs * rsScore));

  // ---- hard rejects: drop weak / extended / noisy / structureless ----------
  // A genuinely confirmed breakout is allowed to sit at/just above the pivot, so the
  // "extended / climax / no-coil" rejects (which describe a PRE-breakout base) are skipped
  // for it — but a parabolic run is still rejected even when confirmed.
  let reject = null;
  if (extAtr > 6) reject = `parabolic — ${r2(extAtr)} ATRs above the 20-MA`;
  else if (!confirmed) {
    if (extAtr > D.extendedATR) reject = `extended ${r2(extAtr)} ATRs above the 20-MA (chase risk)`;
    else if (surge5 > D.climaxPct) reject = `climax — up ${r2(surge5)}% in 5 bars into resistance`;
    else if (atrPct > D.maxAtrPct && (contractRatio == null || contractRatio > 1)) reject = `too wide / noisy — ATR ${r2(atrPct)}% and not contracting`;
    else if (broadening) reject = 'range broadening — no coil forming';
    else if (!tightPass && !vcontractPass && !dryPass) reject = 'no tight base, contraction or volume dry-up — not a real base';
    else if (!trendPass) reject = 'trend not aligned';
  }
  if (reject) return { ok: false, reject, tier: null, readinessScore, distPct: r2(dist), reasons: [] };

  // ---- tier ----------------------------------------------------------------
  let tier;
  if (confirmed) tier = 'CONFIRMED';
  else {
    const corePass = proxPass && trendPass && (tightPass || vcontractPass) && volPass;
    tier = (!cleared && corePass && readinessScore >= D.highScore) ? 'PRE-BREAKOUT' : 'WATCH';
  }

  // ---- factors + human reasons --------------------------------------------
  const factors = [
    { key: 'proximity', label: 'Proximity to level', pass: proxPass, value: r2(dist), reason: cleared ? `through the ${levelLabel}` : `${r2(dist)}% below the ${levelLabel}` },
    { key: 'tight', label: 'Tight consolidation', pass: tightPass, value: r2(rangePct), reason: `range ${r2(rangePct)}% over ${look} bars${narrowing ? ', narrowing' : ''}` },
    { key: 'vcontract', label: 'Volatility contraction', pass: vcontractPass, value: r2(contractRatio), reason: contractRatio == null ? null : `volatility ${r2(contractRatio)}× prior` },
    { key: 'volume', label: 'Volume dry-up / accumulation', pass: volPass, value: r2(dryUp), reason: dryPass ? `volume dry-up ${r2(dryUp)}× the 50-bar avg` : accPass ? `up-volume ${r2(upShare)}% of the base` : null },
    { key: 'trend', label: 'Trend alignment', pass: trendPass, value: trendCount, reason: `MA structure ${trendCount}/4 aligned` },
    { key: 'rs', label: 'Relative strength', pass: rsPass, value: rs ?? perf6M, reason: rsReason },
  ];
  if (confirmed) factors.push({ key: 'confirm', label: 'Breakout confirmation', pass: true, value: r2(lastVolRatio), reason: `cleared on ${r2(lastVolRatio)}× volume, strong close` });

  // Reasons shown to the trader: the passing pillars, most decisive first, capped.
  const order = confirmed ? ['confirm', 'proximity', 'volume', 'trend', 'tight', 'vcontract', 'rs']
    : ['proximity', 'tight', 'vcontract', 'volume', 'trend', 'rs'];
  const reasons = order.map(k => factors.find(f => f.key === k)).filter(f => f && f.pass && f.reason).map(f => f.reason).slice(0, 4);

  return { ok: true, tier, readinessScore, cleared, confirmed, distPct: r2(dist), factors, reasons };
}

export const TIER_ORDER = { CONFIRMED: 0, 'PRE-BREAKOUT': 1, WATCH: 2 };
export const TIER_LABEL = { CONFIRMED: 'CONFIRMED BREAKOUT', 'PRE-BREAKOUT': 'HIGH-CONFIDENCE PRE-BREAKOUT', WATCH: 'WATCH' };
