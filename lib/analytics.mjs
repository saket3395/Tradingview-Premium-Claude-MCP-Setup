// lib/analytics.mjs — strategy analytics on REAL journal outcomes. ANALYSIS ONLY.
// Zero dependencies. Three parts:
//   1. Monte Carlo — bootstrap resampling of realized R-multiples: equity-curve
//      percentile bands, max-drawdown distribution, risk-of-ruin at %-risk sizing.
//   2. Hidden Markov Model — Gaussian HMM (Baum-Welch) on NIFTY daily returns
//      (Upstox historical) → market regime (needs the daily Upstox token).
//   3. Robustness — expectancy ± SE, SQN, rolling PF, threshold sensitivity.
// Every panel reports "insufficient sample" honestly instead of inventing numbers.

import { readFileSync, existsSync } from 'node:fs';
import { allTrades, stats } from './journal.mjs';

const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// ---- 1. Monte Carlo ---------------------------------------------------------
export function monteCarlo(rs, { runs = 5000, riskPct = 1 } = {}) {
  const n = rs.length;
  if (n < 10) return { ok: false, n, need: 10, note: 'Need ≥10 closed trades for a meaningful bootstrap.' };
  const steps = Math.min(Math.max(n, 30), 200);
  const perStep = Array.from({ length: steps }, () => new Float64Array(runs));
  const finals = new Float64Array(runs), maxDDs = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let eq = 0, peak = 0, dd = 0;
    for (let s = 0; s < steps; s++) {
      eq += rs[(Math.random() * n) | 0];
      if (eq > peak) peak = eq;
      if (peak - eq > dd) dd = peak - eq;
      perStep[s][r] = eq;
    }
    finals[r] = eq; maxDDs[r] = dd;
  }
  const pct = (arr, p) => { const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  const bands = ['p5', 'p25', 'p50', 'p75', 'p95'].map(() => []);
  const ps = [0.05, 0.25, 0.5, 0.75, 0.95];
  for (let s = 0; s < steps; s++) ps.forEach((p, i) => bands[i].push(r2(pct(perStep[s], p))));
  // Ruin: a peak-to-trough drawdown of ≥50% of capital at `riskPct`% risk per trade.
  const ruinDD = 50 / riskPct;
  const ruin = Array.from(maxDDs).filter(d => d >= ruinDD).length / runs;
  return {
    ok: true, n, runs, steps, riskPct,
    bands: { p5: bands[0], p25: bands[1], p50: bands[2], p75: bands[3], p95: bands[4] },
    finalR: { p5: r2(pct(finals, 0.05)), p50: r2(pct(finals, 0.5)), p95: r2(pct(finals, 0.95)) },
    maxDD_R: { p50: r2(pct(maxDDs, 0.5)), p95: r2(pct(maxDDs, 0.95)) },
    probProfit: r2(100 * Array.from(finals).filter(x => x > 0).length / runs),
    riskOfRuinPct: r2(100 * ruin),
  };
}

// ---- 2. Gaussian HMM (Baum-Welch with scaling) ------------------------------
export function fitHMM(obs, k = 3, iters = 60) {
  const n = obs.length;
  if (n < 60) return { ok: false, n, need: 60 };
  const mean = obs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(obs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1e-6;
  // init: spread means, equal transitions with sticky diagonal
  let mu = Array.from({ length: k }, (_, i) => mean + sd * (i - (k - 1) / 2));
  let sig = Array.from({ length: k }, () => sd);
  let A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => i === j ? 0.9 : 0.1 / (k - 1)));
  let pi = Array(k).fill(1 / k);
  const g = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)) + 1e-300;

  let alpha = [], beta = [], scale = [];
  for (let it = 0; it < iters; it++) {
    // forward (scaled)
    alpha = []; scale = [];
    let a = pi.map((p, i) => p * g(obs[0], mu[i], sig[i]));
    let c = 1 / (a.reduce((x, y) => x + y, 0) || 1e-300);
    alpha.push(a.map(x => x * c)); scale.push(c);
    for (let t = 1; t < n; t++) {
      a = Array.from({ length: k }, (_, j) =>
        alpha[t - 1].reduce((s2, av, i) => s2 + av * A[i][j], 0) * g(obs[t], mu[j], sig[j]));
      c = 1 / (a.reduce((x, y) => x + y, 0) || 1e-300);
      alpha.push(a.map(x => x * c)); scale.push(c);
    }
    // backward (scaled)
    beta = Array.from({ length: n }, () => Array(k).fill(0));
    beta[n - 1] = Array(k).fill(scale[n - 1]);
    for (let t = n - 2; t >= 0; t--)
      for (let i = 0; i < k; i++) {
        let s2 = 0;
        for (let j = 0; j < k; j++) s2 += A[i][j] * g(obs[t + 1], mu[j], sig[j]) * beta[t + 1][j];
        beta[t][i] = s2 * scale[t];
      }
    // gamma / xi accumulators → re-estimate
    const gamma = alpha.map((av, t) => {
      const raw = av.map((x, i) => x * beta[t][i] / scale[t]);
      const s2 = raw.reduce((x, y) => x + y, 0) || 1e-300;
      return raw.map(x => x / s2);
    });
    const Anew = Array.from({ length: k }, () => Array(k).fill(1e-12));
    for (let t = 0; t < n - 1; t++) {
      let denom = 0;
      const xi = Array.from({ length: k }, () => Array(k).fill(0));
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        xi[i][j] = alpha[t][i] * A[i][j] * g(obs[t + 1], mu[j], sig[j]) * beta[t + 1][j];
        denom += xi[i][j];
      }
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) Anew[i][j] += xi[i][j] / (denom || 1e-300);
    }
    A = Anew.map(row => { const s2 = row.reduce((x, y) => x + y, 0); return row.map(x => x / s2); });
    pi = gamma[0].slice();
    for (let i = 0; i < k; i++) {
      const w = gamma.reduce((s2, gt) => s2 + gt[i], 0) || 1e-300;
      mu[i] = gamma.reduce((s2, gt, t) => s2 + gt[i] * obs[t], 0) / w;
      sig[i] = Math.sqrt(gamma.reduce((s2, gt, t) => s2 + gt[i] * (obs[t] - mu[i]) ** 2, 0) / w) || 1e-6;
    }
  }
  // Viterbi path
  const logA = A.map(r => r.map(Math.log)), path = [];
  let delta = pi.map((p, i) => Math.log(p + 1e-300) + Math.log(g(obs[0], mu[i], sig[i])));
  const psi = [Array(k).fill(0)];
  for (let t = 1; t < n; t++) {
    const nd = [], np = [];
    for (let j = 0; j < k; j++) {
      let best = -Infinity, arg = 0;
      for (let i = 0; i < k; i++) { const v = delta[i] + logA[i][j]; if (v > best) { best = v; arg = i; } }
      nd.push(best + Math.log(g(obs[t], mu[j], sig[j]))); np.push(arg);
    }
    delta = nd; psi.push(np);
  }
  let cur = delta.indexOf(Math.max(...delta));
  path[n - 1] = cur;
  for (let t = n - 1; t > 0; t--) { cur = psi[t][cur]; path[t - 1] = cur; }

  // Label states: highest sigma = High-Volatility; rest by mean sign.
  const order = [...Array(k).keys()];
  const volIdx = order.reduce((a, b) => sig[a] > sig[b] ? a : b);
  const label = i => i === volIdx ? 'High volatility'
    : mu[i] > 0.0004 ? 'Uptrend / low vol' : mu[i] < -0.0004 ? 'Downtrend' : 'Chop / balance';
  return {
    ok: true, n, k,
    states: order.map(i => ({ state: i, label: label(i), meanDailyPct: r2(mu[i] * 100), sdDailyPct: r2(sig[i] * 100), stickiness: r2(A[i][i]) })),
    transition: A.map(row => row.map(r2)),
    path, current: { state: path[n - 1], label: label(path[n - 1]) },
  };
}

// NIFTY daily closes from Upstox (needs the daily token; degrades honestly).
export async function niftyDailyReturns(days = 365) {
  const file = process.env.UPSTOX_TOKEN_FILE;
  let token = null;
  try { token = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).access_token : null; } catch {}
  if (!token) return { ok: false, error: 'No Upstox token — HMM regime needs NIFTY daily history.' };
  const to = new Date(), from = new Date(Date.now() - days * 864e5);
  const d = x => x.toISOString().slice(0, 10);
  const ik = encodeURIComponent('NSE_INDEX|Nifty 50');
  try {
    const res = await fetch(`https://api.upstox.com/v2/historical-candle/${ik}/day/${d(to)}/${d(from)}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `NIFTY candles HTTP ${res.status}` };
    const closes = (j?.data?.candles || []).map(c => ({ date: c[0].slice(0, 10), close: c[4] })).reverse();
    const returns = [];
    for (let i = 1; i < closes.length; i++)
      returns.push({ date: closes[i].date, r: Math.log(closes[i].close / closes[i - 1].close) });
    return { ok: true, returns };
  } catch (e) { return { ok: false, error: `NIFTY candles: ${e.message}` }; }
}

// ---- 3. Robustness ----------------------------------------------------------
export function robustness(trades) {
  const closed = trades.filter(t => t.status === 'CLOSED' && t.rMultiple != null);
  const rs = closed.map(t => t.rMultiple);
  const n = rs.length;
  if (n < 10) return { ok: false, n, need: 10 };
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) || 1e-9;
  const se = sd / Math.sqrt(n);
  const pfOf = list => { const s = stats(list); return s.profitFactor; };
  // Threshold sensitivity: does the edge survive stricter/looser score & R:R cuts?
  const scores = closed.map(t => t.score).filter(x => x != null);
  const base = scores.length ? Math.min(...scores) : 70;
  const sens = [
    { cut: `score ≥ ${base} (all)`, ...pick(closed) },
    { cut: `score ≥ ${base + 5}`, ...pick(closed.filter(t => t.score >= base + 5)) },
    { cut: `score ≥ ${base + 10}`, ...pick(closed.filter(t => t.score >= base + 10)) },
    { cut: 'planned R:R ≥ 2.0', ...pick(closed.filter(t => t.rr >= 2)) },
    { cut: 'entryQuality ≥ 60', ...pick(closed.filter(t => (t.entryQuality ?? 0) >= 60)) },
  ];
  function pick(list) {
    const s = stats(list);
    return { n: s.trades, pf: s.profitFactor, wr: s.winRate, expR: s.expectancyR };
  }
  // Rolling PF (20-trade window), oldest → newest.
  const chrono = [...closed].sort((a, b) => a.triggerTs - b.triggerTs);
  const rolling = [];
  for (let i = 19; i < chrono.length; i++) rolling.push(pfOf(chrono.slice(i - 19, i + 1)));
  return {
    ok: true, n,
    expectancyR: r2(mean), stderrR: r2(se),
    expectancy95: [r2(mean - 1.96 * se), r2(mean + 1.96 * se)],
    sqn: r2(mean / sd * Math.sqrt(n)),
    sensitivity: sens,
    rollingPF: rolling.map(x => x === '∞' ? null : x),
  };
}

// ---- Analytics-tab payload --------------------------------------------------
export async function buildAnalytics({ riskPct = 1 } = {}) {
  const trades = allTrades();
  const closed = trades.filter(t => t.status === 'CLOSED' && t.rMultiple != null);
  const rs = closed.map(t => t.rMultiple);

  const mc = monteCarlo(rs, { riskPct });
  const rob = robustness(trades);

  let regime = { ok: false, error: 'unavailable' };
  const nd = await niftyDailyReturns();
  if (nd.ok) {
    const hmm = fitHMM(nd.returns.map(x => x.r));
    if (hmm.ok) {
      // Per-regime strategy performance: map each trade's date to that day's regime.
      const regimeByDate = {};
      nd.returns.forEach((x, i) => { regimeByDate[x.date] = hmm.path[i]; });
      const byRegime = {};
      for (const t of closed.filter(t => t.market === 'india')) {
        const st = regimeByDate[t.date];
        if (st == null) continue;
        const lbl = hmm.states[st].label;
        (byRegime[lbl] = byRegime[lbl] || []).push(t);
      }
      regime = {
        ok: true, ...hmm, path: undefined,
        source: 'NIFTY daily log-returns (Upstox), ~1y',
        perRegime: Object.fromEntries(Object.entries(byRegime).map(([k, v]) => {
          const s = stats(v); return [k, { n: s.trades, pf: s.profitFactor, wr: s.winRate, expR: s.expectancyR }];
        })),
      };
    } else regime = { ok: false, error: `HMM needs ≥60 daily returns (have ${hmm.n}).` };
  } else regime = nd;

  return { ts: Date.now(), tradesClosed: closed.length, monteCarlo: mc, regime, robustness: rob };
}
