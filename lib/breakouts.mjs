// lib/breakouts.mjs — "closest to breakout" scanners. ANALYSIS ONLY, zero dependencies.
//
// Two tabs are served from ONE pipeline, because the only thing that differs between them
// is which existing engine measures the pivot:
//   Breakout-Patterns   → lib/patterns.mjs  analyzeTF()  (chart-pattern pivots, any TF)
//   VCP / Elliott       → lib/minervini.mjs buildVCP()   (VCP pivot, daily by construction)
//                       → lib/elliott.mjs   countTF()     (prior-wave extreme to clear)
//
// TWO STAGES, for the same reason the TPO scanner has two:
//   Stage 1 — one server-side TradingView scanner request returns the FULL universe with
//     day-level fields (52-week high, SMA50/200, trailing performance, relative volume).
//     That is enough to reject everything that cannot be near a high-quality upside
//     breakout, without spending a single OHLC request.
//   Stage 2 — only the surviving shortlist gets real multi-timeframe OHLC via
//     lib/history.mjs, and the real detectors run on it. Nothing is approximated: the
//     pivot, status and confidence come from the same code the single-symbol tabs use.
//
// STAGE 2 COVERS THE WHOLE STAGE-1 SHORTLIST. `candidates` defaults to "all", so every
// name that survives Stage 1 gets real OHLC and the real detectors — no arbitrary top-N.
//
// That is expensive and the code is built to survive it honestly. A fresh NSE symbol costs
// up to five provider requests, the provider's Cloudflare block trips well below the
// documented quota (see lib/history.mjs), and the deep pass runs SEQUENTIALLY through the
// shared rate limiter. So a cold full India scan is on the order of a few hundred symbols
// x ~3s each. Three things make that workable rather than merely slow:
//   1. If the breaker opens mid-scan the scan STOPS and says so, rather than pretending a
//      partial result is complete.
//   2. A stopped-early result is NOT cached. Caching a partial for 10 minutes would have
//      pinned the scan at whatever it reached and made re-running pointless.
//   3. lib/history.mjs caches per symbol, so a re-run pays nothing for names already
//      fetched and walks further down the list. Successive runs converge on full coverage.
// `analysed / candidates` in the response is the real coverage number — read it.
//
// Passing an explicit positive `candidates` (config value or ?candidates=N) still caps the
// deep pass, which is the cheap way to probe a filter combination before committing to it.
//
// LONG-ONLY, BY DEFINITION. "Closest to breakout" is an upside question — the level above
// price that must be cleared. Bearish structures are not ranked here; the Pattern Analysis
// tab still reports them for a single symbol.

import { post } from './tpo.mjs';
import { getSessionCookie } from './tv.mjs';
import { getSeries } from './history.mjs';
import { analyzeTF } from './patterns.mjs';
import { buildVCP } from './minervini.mjs';
import { countTF } from './elliott.mjs';
import { breakerState } from './ratelimit.mjs';
import { r2 } from './indicators.mjs';
import { qualifyPreBreakout, TIER_ORDER } from './prebreakout.mjs';

const REGIONS = {
  india: { region: 'india', label: '🇮🇳 NSE', exchanges: ['NSE'], needsAuth: false, provider: 'Upstox', providerLabel: 'NSE data' },
  usa: { region: 'america', label: '🇺🇸 US', exchanges: ['NASDAQ', 'NYSE', 'AMEX'], needsAuth: true, provider: 'Alpaca', providerLabel: 'US data' },
};

// Stage-1 columns (all verified present on both scans; positional response).
const COLS = ['name', 'close', 'volume', 'average_volume_10d_calc', 'market_cap_basic',
  'relative_volume_10d_calc', 'price_52_week_high', 'price_52_week_low',
  'SMA50', 'SMA200', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'ATR', 'change', 'update_mode'];

export const TIMEFRAMES = ['4H', '1D', '1W', '1M'];

// The bullish chart patterns lib/patterns.mjs can detect, i.e. the ones that define a
// level above price to clear. Bearish detections (double top, H&S, breakdown …) are
// excluded by design — see the header.
export const PATTERN_TYPES = ['Ascending Triangle', 'Symmetrical Triangle', 'Rectangle',
  'Falling Wedge', 'Ascending Channel', 'Bull Flag', 'Pennant', 'Cup & Handle', 'VCP',
  'Double Bottom', 'Inverse Head & Shoulders', 'Breakout', 'Breakout Retest',
  'Trend Continuation', 'Trend Reversal'];

// Where each detector records the level that must be cleared, most specific first.
const LEVEL_KEYS = ['pivot', 'trigger', 'neckline', 'resistance', 'level'];

const CACHE_MS = 10 * 60 * 1000;
const _cache = new Map();        // scanKey -> { ts, result }

const readiness = d => d <= 0.5 ? 'AT PIVOT' : d <= 2 ? 'NEAR' : 'APPROACHING';

// ---- Stage 1: universe → ranked shortlist -----------------------------------
async function shortlist(m, conf) {
  const cookie = m.needsAuth ? await getSessionCookie() : '';
  const j = await post(m.region, {
    filter: [
      { left: 'exchange', operation: 'in_range', right: m.exchanges },
      { left: 'is_primary', operation: 'equal', right: true },
      { left: 'type', operation: 'equal', right: 'stock' },
    ],
    options: { lang: 'en' }, columns: COLS,
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
    range: [0, 10000],
  }, cookie);

  const rows = (j.data || []).map(row => {
    const o = { ticker: row.s };
    COLS.forEach((c, i) => { o[c] = row.d[i]; });
    return o;
  });

  const modes = rows.map(r => r.update_mode).filter(Boolean);
  const dataStatus = modes.filter(x => x === 'streaming').length >= modes.length * 0.5 ? 'live'
    : modes.some(x => /end_of_day|eod/i.test(x)) ? 'closed'
      : modes.some(x => /delayed/.test(x)) ? 'delayed' : 'unknown';

  // Quality gates. Each one exists to keep the (expensive) deep pass off names that
  // cannot produce a high-quality upside breakout candidate.
  const cands = [];
  for (const r of rows) {
    const c = r.close, hi = r.price_52_week_high;
    if (![c, hi, r.SMA50, r.SMA200].every(v => typeof v === 'number' && isFinite(v))) continue;
    if (c < conf.minPrice) continue;
    if ((r.average_volume_10d_calc ?? 0) < conf.minAvgVol) continue;
    if (conf.minMarketCap && (r.market_cap_basic ?? 0) < conf.minMarketCap) continue;
    if (c < r.SMA50 || c < r.SMA200) continue;                     // uptrend only
    if ((r['Perf.6M'] ?? -1) <= 0) continue;                       // 6-month advance intact
    const fromHigh = (hi - c) / c * 100;                           // % still to clear
    if (fromHigh < 0 || fromHigh > conf.maxFromHighPct) continue;  // near the high, not far below
    cands.push({
      ticker: r.ticker, symbol: r.name, close: r2(c), high52: r2(hi), low52: r2(r.price_52_week_low),
      fromHighPct: r2(fromHigh), rVol: r2(r.relative_volume_10d_calc), changePct: r2(r.change),
      perf3M: r2(r['Perf.3M']), perf6M: r2(r['Perf.6M']), perfY: r2(r['Perf.Y']),
      // Proximity first, then momentum and participation: the shortlist should be the
      // names most likely to actually clear a pivot in the near term.
      rank: fromHigh - 0.05 * (r['Perf.6M'] ?? 0) - 2 * (r.relative_volume_10d_calc ?? 0),
    });
  }
  cands.sort((a, b) => a.rank - b.rank);
  return { universe: rows.length, dataStatus, prefiltered: cands.length, cands };
}

// ---- Stage 2 evaluators (each returns 0..n rows for one symbol) --------------
function fromPatterns(series, symbol, tf, patternType, conf, q = {}) {
  const s = series.tfs?.[tf];
  if (!s?.ok) return { rows: [], skip: `${symbol}: ${tf} history unavailable` };
  const a = analyzeTF(s.bars, tf);
  if (!a.ok) return { rows: [], skip: `${symbol}: ${a.error}` };
  const out = [];
  for (const p of a.patterns) {
    if (p.bias <= 0 || p.status === 'Failed') continue;
    if (patternType !== 'all' && p.name !== patternType) continue;
    const key = LEVEL_KEYS.find(k => p.levels?.[k] != null && p.levels[k] > 0);
    if (!key) continue;
    const level = p.levels[key];
    const dist = (level - a.close) / a.close * 100;
    if (dist < -conf.maxAbovePct || dist > conf.maxDistPct) continue;
    if (p.confidence < conf.minConfidence) continue;
    out.push({
      symbol, ticker: series.symbol, timeframe: a.label, price: a.close,
      pattern: p.name, status: p.status, confidence: p.confidence, score: p.score,
      levelLabel: key, breakoutLevel: level, distPct: r2(dist), readiness: readiness(dist),
      target: p.levels?.target ?? null, stage: a.stage.label, structure: a.structure.label,
      rvol: a.rvol, atrPct: a.atrPct, detail: p.detail,
    });
  }
  // One row per symbol: the best-scoring qualifying pattern, so the table ranks symbols.
  out.sort((a2, b) => b.score - a2.score || a2.distPct - b.distPct);
  const top = out[0];
  if (!top) return { rows: [] };
  // Multi-factor pre-breakout gate on the chosen pivot: reject noise/extension, tier the rest.
  const g = qualifyPreBreakout({ bars: s.bars, level: top.breakoutLevel, close: a.close, atrVal: a.atr,
    perf6M: q.perf6M, levelLabel: top.levelLabel, cfg: conf.prebreakout });
  if (!g.ok) return { rows: [], skip: `${symbol}: ${g.reject}` };
  return { rows: [attachTier(top, g)] };
}

// Attach the pre-breakout verdict to a row without disturbing the engine's own fields.
function attachTier(row, g) {
  return { ...row, tier: g.tier, readinessScore: g.readinessScore,
    confirmed: g.confirmed, qualifyReasons: g.reasons, factors: g.factors };
}

async function fromVCP(series, symbol, conf, q = {}) {
  const r = await buildVCP(series);
  if (!r.ok) return { rows: [], skip: `${symbol}: ${r.error}` };
  if (!r.vcp?.ok || !r.tradePlan) return { rows: [], skip: `${symbol}: ${r.verdict.why}` };
  const dist = r.vcp.distToPivotPct;
  if (dist < -conf.maxAbovePct || dist > conf.maxDistPct) return { rows: [] };
  const row = {
    symbol, ticker: series.symbol, type: 'VCP', timeframe: 'Daily',
    price: r.price, verdict: r.verdict.label, confidence: r.verdict.confidence, score: r.verdict.score,
    breakoutLevel: r.tradePlan.pivot, distPct: r2(dist), readiness: readiness(dist),
    stop: r.tradePlan.stop, targets: r.tradePlan.targets, rr: r.tradePlan.rr,
    detail: `Trend Template ${r.trendTemplate.passed}/8${r.rs.ok ? ` · RS ${r.rs.rs}` : ''} · contractions `
      + `${r.vcp.footprint} over ${r.vcp.baseBars} sessions · base ${r.vcp.baseDepthPct}% deep · `
      + `final-leg volume ${r.vcp.dryUpVs50d ?? '—'}× the 50-day average.`,
    invalidation: r.tradePlan.stop, rs: r.rs.ok ? r.rs.rs : null,
    trendTemplate: `${r.trendTemplate.passed}/8`, stage: r.context.weeklyStage?.label || r.context.dailyStage.label,
  };
  // Same pre-breakout tiering as the other engines, on the VCP pivot, using the true RS
  // percentile the VCP screen already computed. A VCP base has passed a strict screen, so
  // its rejects rarely fire — but the tier (WATCH / PRE-BREAKOUT / CONFIRMED) is consistent.
  const s = series.tfs?.['1D'];
  if (s?.ok) {
    const g = qualifyPreBreakout({ bars: s.bars, level: r.tradePlan.pivot, close: r.price,
      perf6M: q.perf6M, rs: r.rs.ok ? r.rs.rs : null, levelLabel: 'pivot', cfg: conf.prebreakout });
    if (!g.ok) return { rows: [], skip: `${symbol}: ${g.reject}` };
    return { rows: [attachTier(row, g)] };
  }
  return { rows: [row] };
}

function fromElliott(series, symbol, tf, conf, q = {}) {
  // countTF, not buildElliott: buildElliott chooses its own primary timeframe (Daily
  // first), which would silently ignore the tab's timeframe filter.
  const s = series.tfs?.[tf];
  if (!s?.ok) return { rows: [], skip: `${symbol}: ${tf} history unavailable` };
  const t = countTF(s.bars, tf);
  const p = t.counts[0];
  if (!p) return { rows: [], skip: `${symbol}: ${t.error || 'no rule-valid wave count'}` };
  // Only a live up-impulse in wave 3 or wave 5 poses a breakout question: the level to
  // clear is the previous same-direction wave's extreme. Anything else (corrections,
  // completed counts, down impulses) has no upside trigger to rank.
  if (p.structure !== 'Impulse' || p.direction !== 'up' || !p.inProgress) {
    return { rows: [], skip: `${symbol}: ${p.position} — no upside trigger` };
  }
  if (![3, 5].includes(p.waveNumber)) return { rows: [], skip: `${symbol}: wave ${p.waveNumber} — no upside trigger` };
  const prior = p.waves[p.waveNumber === 3 ? 0 : 2];               // wave 1 high / wave 3 high
  const level = prior?.to;
  const price = t.close;
  if (level == null || price == null) return { rows: [] };
  const dist = (level - price) / price * 100;
  if (dist < -conf.maxAbovePct || dist > conf.maxDistPct) return { rows: [] };
  const proj = (p.projections || []).filter(x => x.price > price).sort((a, b) => a.price - b.price)[0];
  const row = {
    symbol, ticker: series.symbol, type: 'Elliott Wave', timeframe: t.label,
    price, verdict: `Wave ${p.waveLabel} in progress`, confidence: p.confidence,
    score: p.guidelineScore, breakoutLevel: r2(level), distPct: r2(dist), readiness: readiness(dist),
    targets: proj ? [proj.price] : [], rr: null, stop: p.invalidation, invalidation: p.invalidation,
    detail: `${p.position} (${p.degree} degree, ${tf} count) · rules ${p.ruleCompliance} · clears the wave `
      + `${p.waveNumber === 3 ? '1' : '3'} high ${r2(level)}${proj ? ` · next projection ${proj.label} ${proj.price}` : ''} · `
      + `invalidation ${p.invalidation} (${p.invalidationRule}).`,
    stage: `${p.degree} degree`, rs: null, trendTemplate: null,
  };
  const g = qualifyPreBreakout({ bars: s.bars, level, close: price,
    perf6M: q.perf6M, levelLabel: 'wave level', cfg: conf.prebreakout });
  if (!g.ok) return { rows: [], skip: `${symbol}: ${g.reject}` };
  return { rows: [attachTier(row, g)] };
}

// "all" (or 0, or anything non-numeric/absent) means the entire Stage-1 shortlist; a
// positive number caps the deep pass at that many names.
function resolveCandidates(v) {
  if (v === 'all' || v == null || v === '') return Infinity;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : Infinity;
}
const candidatesLabel = n => (Number.isFinite(n) ? n : 'all');

// ---- public: one scanner, three engines --------------------------------------
// engine: 'patterns' | 'vcp' | 'elliott'
export async function scanBreakouts({ engine = 'patterns', market = 'india', tf = '1D',
  patternType = 'all', cfg = {}, candidates } = {}) {
  const m = REGIONS[market];
  if (!m) throw new Error(`unknown market: ${market}`);
  if (!TIMEFRAMES.includes(tf)) throw new Error(`unknown timeframe: ${tf}`);
  if (!['patterns', 'vcp', 'elliott'].includes(engine)) throw new Error(`unknown engine: ${engine}`);
  if (patternType !== 'all' && !PATTERN_TYPES.includes(patternType)) throw new Error(`unknown pattern: ${patternType}`);

  const conf = {
    minPrice: cfg.minPrice ?? (market === 'india' ? 20 : 5),
    minAvgVol: cfg.minAvgVol ?? (market === 'india' ? 200000 : 300000),
    minMarketCap: cfg.minMarketCap ?? (market === 'india' ? 5e9 : 3e8),
    maxFromHighPct: cfg.maxFromHighPct ?? 15,
    maxDistPct: cfg.maxDistPct ?? 5,
    maxAbovePct: cfg.maxAbovePct ?? 1,        // already through the pivot by up to this much
    minConfidence: cfg.minConfidence ?? 55,
    candidates: resolveCandidates(candidates ?? cfg.candidates),
    top: cfg.top ?? 25,
    prebreakout: cfg.prebreakout || {},   // multi-factor pre-breakout thresholds (see lib/prebreakout.mjs)
  };
  // VCP is a daily-base method by construction, so the timeframe filter cannot apply to it.
  const effTf = engine === 'vcp' ? '1D' : tf;

  const key = `${engine}|${market}|${effTf}|${patternType}|${candidatesLabel(conf.candidates)}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return { ...hit.result, cached: true };

  const pre = await shortlist(m, conf);
  const cands = pre.cands.slice(0, conf.candidates);

  const rows = [], skipped = [];
  let stoppedEarly = null, analysed = 0;
  for (const c of cands) {
    const open = breakerState(m.provider);
    if (open) { stoppedEarly = `${m.providerLabel} is rate limiting — stopped after ${analysed} of ${cands.length} candidates (retry in ${open}s).`; break; }
    let series;
    try { series = await getSeries(c.ticker); } catch (e) { skipped.push(`${c.symbol}: ${e.message}`); continue; }
    if (!series.ok) {
      skipped.push(`${c.symbol}: ${series.error}`);
      if (series.rateLimited) { stoppedEarly = `${m.providerLabel} is rate limiting — stopped after ${analysed} of ${cands.length} candidates.`; break; }
      continue;
    }
    analysed++;
    let out;
    const q = { perf6M: c.perf6M };
    try {
      out = engine === 'vcp' ? await fromVCP(series, c.symbol, conf, q)
        : engine === 'elliott' ? fromElliott(series, c.symbol, effTf, conf, q)
          : fromPatterns(series, c.symbol, effTf, patternType, conf, q);
    } catch (e) { skipped.push(`${c.symbol}: ${e.message}`); continue; }
    if (out.skip) skipped.push(out.skip);
    for (const r of out.rows) rows.push({ ...r, fromHighPct: c.fromHighPct, high52: c.high52, changePct: c.changePct, scanRVol: c.rVol, perf6M: c.perf6M });
  }

  // Lifecycle stage first (CONFIRMED → PRE-BREAKOUT → WATCH), then breakout-readiness
  // score, then proximity — so the cleanest, most-ready setups surface at the top.
  rows.sort((a, b) =>
    (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3)
    || (b.readinessScore ?? 0) - (a.readinessScore ?? 0)
    || a.distPct - b.distPct
    || (b.score ?? 0) - (a.score ?? 0));
  const tierCounts = rows.reduce((m, r) => (m[r.tier] = (m[r.tier] || 0) + 1, m), {});

  const result = {
    ok: true, ts: Date.now(), engine, market, marketLabel: m.label,
    timeframe: effTf, requestedTimeframe: tf, patternType,
    dataStatus: pre.dataStatus, universe: pre.universe, prefiltered: pre.prefiltered,
    candidates: cands.length, analysed, count: rows.length, tierCounts,
    rows: rows.slice(0, conf.top), skipped: skipped.slice(0, 12), stoppedEarly,
    thresholds: {
      maxDistPct: conf.maxDistPct, maxFromHighPct: conf.maxFromHighPct,
      minConfidence: conf.minConfidence, candidates: candidatesLabel(conf.candidates),
      minPrice: conf.minPrice, minAvgVol: conf.minAvgVol,
    },
    note: [
      `Stage 1 screened ${pre.universe} ${m.label} names to ${pre.prefiltered} in an uptrend within ${conf.maxFromHighPct}% of their 52-week high; `
      + `Stage 2 ran real ${engine === 'vcp' ? 'Minervini VCP' : engine === 'elliott' ? 'Elliott Wave' : 'pattern'} analysis on `
      + `${Number.isFinite(conf.candidates) ? `the top ${cands.length}` : `all ${cands.length}`} of them (${analysed} completed).`,
      engine === 'vcp' && tf !== '1D' ? 'VCP bases are measured on daily bars by construction — the timeframe filter does not apply to this engine.' : '',
      stoppedEarly ? stoppedEarly + ' Symbols already fetched are cached, so pressing Scan again resumes from where this run stopped rather than starting over.' : '',
      `Each surviving pivot is scored for pre-breakout confluence (tight base, volatility contraction, volume dry-up/accumulation, trend alignment, relative strength) and sorted into CONFIRMED BREAKOUT / HIGH-CONFIDENCE PRE-BREAKOUT / WATCH; extended, wide/noisy and structureless names are rejected outright.`,
      `Only pivots within ${conf.maxDistPct}% above price (or up to ${conf.maxAbovePct}% already cleared) are listed. Analysis only — no orders are placed.`,
    ].filter(Boolean).join(' '),
  };
  // A scan that stopped early is a partial answer. Caching it would pin coverage at
  // whatever the breaker allowed and make the next run a no-op — the opposite of what a
  // user hitting Scan again wants. Only complete passes are cached.
  if (!stoppedEarly) _cache.set(key, { ts: Date.now(), result });
  return result;
}
