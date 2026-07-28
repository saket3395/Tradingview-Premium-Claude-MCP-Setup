// lib/minervini.mjs — Mark Minervini SEPA / VCP analysis. ANALYSIS ONLY, zero deps.
//
// Two gates and a trade plan, in the order Minervini actually applies them:
//
//   1. TREND TEMPLATE (8 criteria) — the coarse filter. A stock that fails this is not a
//      candidate no matter how pretty the base looks, so we short-circuit to FAIL and do
//      not dignify it with a VCP reading.
//   2. VCP — successive volatility contractions, each materially tighter than the last,
//      on drying volume, inside a Stage-2 base. This is supply being absorbed: each
//      pullback shakes out weaker holders until almost none are left to sell.
//   3. TRADE PLAN — pivot (buy point), optional low-cheat entry, stop, and the resulting
//      R:R. Minervini's risk rule is the point of the whole exercise: a tight pivot is
//      what lets you take a small, defined loss when it fails.
//
// Everything is computed from the same real OHLC series the Pattern Analysis tab uses
// (lib/history.mjs) and the shared primitives in lib/indicators.mjs — no duplicated maths.
// RS Rating is a true market percentile from lib/rs.mjs.
//
// HONEST SCOPE: this is the TECHNICAL half of SEPA only. Minervini's method also demands
// earnings/sales acceleration and institutional sponsorship, which this dashboard has no
// data for. A BUY-READY verdict here means "the chart qualifies", never "buy this".

import { r2, clamp, sma, atr, evidence, zigzag, slopePct } from './indicators.mjs';
import { stageOf } from './patterns.mjs';
import { rsFor } from './rs.mjs';

const MIN_RS = 70;              // Minervini's floor; he prefers 80-90+
const MAX_BASE_DEPTH = 35;      // % — deeper than this is a broken stock, not a base
const MIN_BASE_BARS = 25;       // ~5 weeks
const MAX_CONTRACTION = 0.75;   // each pullback must be ≤75% of the prior (he says ~half)

// ---- 1. Trend Template ------------------------------------------------------
// All eight criteria, computed from daily bars (>252 available, so the 52-week
// high/low is a true 52 weeks) plus the RS percentile.
function trendTemplate(bars, rs) {
  const closes = bars.map(b => b.c);
  const c = closes[closes.length - 1];
  const ma50 = sma(closes, 50), ma150 = sma(closes, 150), ma200 = sma(closes, 200);
  if (ma200 == null) {
    return { ok: false, error: `Only ${bars.length} daily bars — the Trend Template needs ≥200 for the 200-day MA.` };
  }
  const yr = bars.slice(-252);
  const hi52 = Math.max(...yr.map(b => b.h)), lo52 = Math.min(...yr.map(b => b.l));
  // "200-MA trending up for at least one month" — slope of the MA itself over ~22 sessions.
  const ma200Series = bars.map((_, i) => sma(closes, 200, i));
  const ma200Slope = slopePct(ma200Series.filter(x => x != null), 22);
  const aboveLowPct = (c - lo52) / lo52 * 100;
  const belowHighPct = (hi52 - c) / hi52 * 100;

  const crit = [
    { id: 1, label: 'Price above both the 150-day and 200-day MA', pass: c > ma150 && c > ma200, actual: `close ${r2(c)} vs 150-MA ${r2(ma150)} / 200-MA ${r2(ma200)}` },
    { id: 2, label: '150-day MA above the 200-day MA', pass: ma150 > ma200, actual: `${r2(ma150)} vs ${r2(ma200)}` },
    { id: 3, label: '200-day MA trending up for at least 1 month', pass: (ma200Slope ?? -1) > 0, actual: `${ma200Slope > 0 ? '+' : ''}${r2(ma200Slope)}% over 22 sessions` },
    { id: 4, label: '50-day MA above both the 150-day and 200-day MA', pass: ma50 > ma150 && ma50 > ma200, actual: `50-MA ${r2(ma50)}` },
    { id: 5, label: 'Price above the 50-day MA', pass: c > ma50, actual: `close ${r2(c)} vs ${r2(ma50)}` },
    { id: 6, label: 'Price at least 30% above the 52-week low', pass: aboveLowPct >= 30, actual: `+${r2(aboveLowPct)}% above ${r2(lo52)}` },
    { id: 7, label: 'Price within 25% of the 52-week high', pass: belowHighPct <= 25, actual: `−${r2(belowHighPct)}% from ${r2(hi52)}` },
    { id: 8, label: `RS Rating ≥ ${MIN_RS}`, pass: rs.ok && rs.rs >= MIN_RS, actual: rs.ok ? `RS ${rs.rs}` : (rs.error || 'unavailable') },
  ];
  const passed = crit.filter(x => x.pass).length;
  return {
    ok: true, passed, total: 8, criteria: crit,
    ma50: r2(ma50), ma150: r2(ma150), ma200: r2(ma200), ma200SlopePct: r2(ma200Slope),
    high52: r2(hi52), low52: r2(lo52), aboveLowPct: r2(aboveLowPct), belowHighPct: r2(belowHighPct),
  };
}

// ---- 2. VCP contractions ----------------------------------------------------
// Legs come from the shared ZigZag (significance-filtered swings), not the 5-bar fractal:
// a base's contractions are defined by meaningful reversals, not by every local wiggle.
function contractions(bars) {
  const win = Math.min(bars.length, 160);
  const w = bars.slice(-win);
  const A = atr(w, 14);
  const px = w[w.length - 1].c;
  if (!A) return { ok: false, error: 'Not enough bars to measure volatility.' };

  // Threshold sized to real contractions (3%+), not daily noise, with a minimum pivot
  // separation so one bar cannot both end and start a swing.
  const zz = zigzag(w, Math.max(1.2 * A, 0.025 * px), 3);

  // Contractions = each swing high paired with the following swing low.
  const legs = [];
  for (let i = 0; i < zz.length - 1; i++) {
    if (zz[i].kind !== 'H' || zz[i + 1].kind !== 'L') continue;
    const h = zz[i], l = zz[i + 1];
    const depth = (h.p - l.p) / h.p * 100;
    if (depth <= 0) continue;
    const seg = w.slice(h.i, l.i + 1);
    legs.push({ hi: h.p, lo: l.p, hiI: h.i, loI: l.i, depthPct: depth, bars: l.i - h.i,
      vol: sma(seg.map(b => b.v || 0), seg.length) });
  }
  if (legs.length < 2) return { ok: false, error: `Only ${legs.length} measurable contraction(s) — a VCP needs at least 2.` };

  // The base is the LAST k contractions. Which k is not knowable in advance, so try the
  // widest base first (6) and fall back — the largest run that satisfies every structural
  // rule is the base. Anchoring instead to the single highest high fails for exactly the
  // population that matters: leaders near their highs, where that high is the newest pivot.
  let run = null, baseStart, baseBars, baseHigh, baseLow, baseDepthPct, why = null;
  for (let k = Math.min(6, legs.length); k >= 2; k--) {
    const cand = legs.slice(-k);
    const f = cand[0], l = cand[k - 1];
    const start = f.hiI, bars2 = (w.length - 1) - start;
    const seg = w.slice(start);
    const hi = Math.max(...seg.map(b => b.h)), lo = Math.min(...seg.map(b => b.l));
    const depth = (hi - lo) / hi * 100;
    // Minervini's requirement is that volatility CONTRACTS across the base — the final
    // pullback materially tighter than the first. Demanding every single step be tighter
    // rejects almost every real base, so allow one widening step and judge the trend.
    const increases = cand.slice(1).filter((x, i) => x.depthPct > cand[i].depthPct).length;
    if (bars2 < MIN_BASE_BARS) { why = `Base is only ${bars2} sessions — needs ≥${MIN_BASE_BARS} (about 5 weeks) to absorb supply.`; continue; }
    if (depth > MAX_BASE_DEPTH) { why = `Base is ${r2(depth)}% deep — beyond the ${MAX_BASE_DEPTH}% limit for a constructive base.`; continue; }
    if (l.depthPct > MAX_CONTRACTION * f.depthPct) { why = `Volatility is not contracting — final pullback ${r2(l.depthPct)}% vs first ${r2(f.depthPct)}% (needs ≤${Math.round(MAX_CONTRACTION * 100)}% of it).`; continue; }
    if (increases > 1) { why = `Contractions are erratic (${increases} widening steps) — not a clean VCP footprint.`; continue; }
    if (l.depthPct > 12) { why = `Final contraction is ${r2(l.depthPct)}% — too loose; a tradable pivot needs ≤12%.`; continue; }
    run = cand; baseStart = start; baseBars = bars2; baseHigh = hi; baseLow = lo; baseDepthPct = depth;
    break;
  }
  if (!run) return { ok: false, error: why || 'No contraction sequence forms a valid base.' };
  const first = run[0], last = run[run.length - 1];

  // Volume dry-up: last contraction vs the first, and vs the 50-day average.
  const avg50 = sma(w.map(b => b.v || 0), 50);
  const dryVsFirst = first.vol ? last.vol / first.vol : null;
  const dryVs50 = avg50 ? last.vol / avg50 : null;

  // Tightness: how narrow the most recent action is — Minervini's "tight closes".
  const tail = w.slice(-Math.min(10, Math.max(5, last.bars)));
  const tightPct = (Math.max(...tail.map(b => b.h)) - Math.min(...tail.map(b => b.l))) / px * 100;

  // Pivot = the high of the final contraction: the price that must be cleared.
  const pivot = last.hi;
  const distToPivotPct = (pivot - px) / px * 100;

  return {
    ok: true, count: run.length,
    contractions: run.map((x, i) => ({
      n: i + 1, high: r2(x.hi), low: r2(x.lo), depthPct: r2(x.depthPct), bars: x.bars,
      vsPrior: i ? r2(x.depthPct / run[i - 1].depthPct) : null,
      volVs50d: avg50 ? r2(x.vol / avg50) : null,
    })),
    footprint: run.map(x => `${Math.round(x.depthPct)}%`).join(' → '),
    baseHigh: r2(baseHigh), baseLow: r2(baseLow), baseDepthPct: r2(baseDepthPct), baseBars,
    dryUpVsFirst: r2(dryVsFirst), dryUpVs50d: r2(dryVs50),
    tightnessPct: r2(tightPct), pivot: r2(pivot), distToPivotPct: r2(distToPivotPct),
    lastDepthPct: r2(last.depthPct), lastLow: r2(last.lo),
  };
}

// ---- 3. Trade plan ----------------------------------------------------------
// Stop is the tighter of the final contraction's low and a hard −7%: Minervini caps
// single-trade risk rather than letting the chart dictate an unlimited stop.
function tradePlan(vcp, px, A) {
  const pivot = vcp.pivot;
  const structural = vcp.lastLow;
  const hardCap = pivot * 0.93;
  const stop = Math.max(structural, hardCap);
  const stopPct = (pivot - stop) / pivot * 100;
  const risk = pivot - stop;
  // "Low cheat" — Minervini's earlier entry inside the final contraction, roughly at its
  // midpoint, taken only when the contraction is already very tight.
  const cheat = vcp.lastDepthPct <= 8 ? r2(structural + 0.5 * (pivot - structural)) : null;
  return {
    pivot: r2(pivot), cheatEntry: cheat, stop: r2(stop), stopPct: r2(stopPct),
    stopBasis: structural >= hardCap ? 'final contraction low' : 'hard −7% risk cap',
    trigger: `close above ${r2(pivot)} on ≥1.5× average volume`,
    targets: [r2(pivot + 2 * risk), r2(pivot + 3 * risk)],
    rr: 3, atr: r2(A),
    sizing: `at 1% account risk, position = 1% ÷ ${r2(stopPct)}% ≈ ${r2(100 / stopPct)}% of capital`,
  };
}

// ---- report -----------------------------------------------------------------
export async function buildVCP(series) {
  const d = series.tfs?.['1D'], w = series.tfs?.['1W'];
  if (!d?.ok) return { ok: false, symbol: series.symbol, error: `Daily history unavailable — ${d?.error || 'no data'}.` };
  const daily = d.bars, weekly = w?.ok ? w.bars : null;
  const px = daily[daily.length - 1].c;
  const A = atr(daily, 14);

  const rs = await rsFor(series.symbol, series.market);
  const tt = trendTemplate(daily, rs);
  if (!tt.ok) return { ok: false, symbol: series.symbol, error: tt.error };

  const wStage = weekly && weekly.length >= 30 ? stageOf(weekly, atr(weekly, 14)) : null;
  const dStage = stageOf(daily, A);

  // Gate 1 — Trend Template + Stage 2. Fail here and the base is irrelevant.
  const ttPass = tt.passed >= 7;
  const stagePass = !wStage || wStage.stage === 2;
  const eligible = ttPass && stagePass;

  const vcp = eligible ? contractions(daily) : { ok: false, error: 'Not evaluated — the stock failed the Trend Template / Stage-2 gate.' };
  const plan = vcp.ok ? tradePlan(vcp, px, A) : null;

  // Verdict.
  let verdict, why;
  if (!ttPass) { verdict = 'FAIL'; why = `Trend Template ${tt.passed}/8 — ${tt.criteria.filter(c => !c.pass).map(c => c.label).join('; ')}.`; }
  else if (!stagePass) { verdict = 'FAIL'; why = `Weekly ${wStage.label} — Minervini buys only Stage 2 advances.`; }
  else if (!vcp.ok) { verdict = 'WATCH'; why = `Trend Template ${tt.passed}/8 passes but no valid VCP base: ${vcp.error}`; }
  else if (vcp.distToPivotPct <= 2 && vcp.distToPivotPct >= -1) { verdict = 'BUY-READY'; why = `Price is ${r2(Math.abs(vcp.distToPivotPct))}% from the ${vcp.pivot} pivot with ${vcp.count} contractions (${vcp.footprint}).`; }
  else if (vcp.distToPivotPct < -1) { verdict = 'EXTENDED'; why = `Price is already ${r2(-vcp.distToPivotPct)}% above the ${vcp.pivot} pivot — the low-risk entry has passed; do not chase.`; }
  else { verdict = 'SETUP FORMING'; why = `Base is constructive but price is ${r2(vcp.distToPivotPct)}% below the ${vcp.pivot} pivot — set an alert, do not anticipate.`; }

  const confidence = vcp.ok ? evidence([
    [3, clamp(tt.passed / 8)],
    [3, rs.ok ? clamp((rs.rs - 50) / 45) : 0.2],
    [2, clamp(1 - (vcp.contractions.slice(1).reduce((s, c) => s + c.vsPrior, 0) / Math.max(1, vcp.count - 1)))],
    [2, vcp.dryUpVs50d != null ? clamp(1.4 - vcp.dryUpVs50d) : 0.4],
    [2, clamp(1 - vcp.tightnessPct / 12)],
    [1, clamp(vcp.baseBars / 60)],
    [2, wStage?.stage === 2 ? clamp(wStage.confidence / 100) : 0.2],
  ]) : evidence([[3, clamp(tt.passed / 8)], [2, rs.ok ? clamp((rs.rs - 50) / 45) : 0.2]]);

  // Score penalties matter more than the bonus here. A stock can have a perfect Trend
  // Template and a 90+ RS and still be un-buyable because there is no base to buy — WATCH
  // must not inherit a near-10 score from trend quality alone.
  const penalty = { 'BUY-READY': 0.8, 'SETUP FORMING': 0, 'EXTENDED': -1, 'WATCH': -2.5, 'FAIL': -3 }[verdict] ?? 0;
  const score = r2(clamp(confidence / 10 + penalty, 0, 10));

  const conclusion = [];
  conclusion.push(`${verdict} — ${why}`);
  conclusion.push(`Trend Template ${tt.passed}/8${rs.ok ? `, RS Rating ${rs.rs} vs ${rs.universe} ranked names` : ', RS unavailable'}`
    + `${wStage ? `, weekly ${wStage.label}` : ''}.`);
  if (vcp.ok) {
    conclusion.push(`Contraction footprint ${vcp.footprint} over ${vcp.baseBars} sessions; base ${vcp.baseDepthPct}% deep, `
      + `final leg volume ${vcp.dryUpVs50d}× the 50-day average${vcp.dryUpVs50d != null && vcp.dryUpVs50d < 0.8 ? ' (supply drying up)' : ''}.`);
    conclusion.push(`Plan: buy above ${plan.pivot} on volume, stop ${plan.stop} (−${plan.stopPct}%, ${plan.stopBasis}), targets ${plan.targets.join(' / ')} at 2R/3R. ${plan.sizing}.`);
  }
  conclusion.push('Technical half of SEPA only — earnings acceleration and institutional sponsorship are not evaluated here.');

  return {
    ok: true, ts: Date.now(), symbol: series.symbol, market: series.market, source: series.source,
    price: r2(px), atr: r2(A),
    verdict: { label: verdict, why, confidence, score },
    rs, trendTemplate: tt, vcp, tradePlan: plan,
    context: {
      weeklyStage: wStage ? { label: wStage.label, confidence: wStage.confidence, ma: wStage.ma } : null,
      dailyStage: { label: dStage.label, confidence: dStage.confidence, ma: dStage.ma },
    },
    conclusion,
  };
}
