// lib/indicators.mjs — shared technical primitives. ANALYSIS ONLY, zero dependencies.
//
// Extracted verbatim from lib/patterns.mjs so the Pattern Analysis, Minervini VCP and
// (later) Elliott Wave engines compute from ONE implementation — no duplicated maths,
// no drift between tabs. Bars are always { t, o, h, l, c, v }, oldest-first, as produced
// by lib/history.mjs.

export const r2 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 100) / 100;
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export const sma = (a, n, i = a.length - 1) =>
  i + 1 < n ? null : a.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n;

export function atr(bars, n = 14) {
  if (bars.length < n + 1) return null;
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const p = bars[i - 1];
    s += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - p.c), Math.abs(bars[i].l - p.c));
  }
  return s / n;
}

// Fractal swing pivots: a high with k lower highs on each side (and the mirror for lows).
export function pivots(bars, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isH = false;
      if (bars[j].l <= bars[i].l) isL = false;
    }
    if (isH) highs.push({ i, p: bars[i].h });
    if (isL) lows.push({ i, p: bars[i].l });
  }
  return { highs, lows };
}

// Least-squares fit of pivot prices against bar index. Returns slope per bar + R².
export function lineFit(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.i, 0) / n, my = pts.reduce((s, p) => s + p.p, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.i - mx) * (p.p - my); sxx += (p.i - mx) ** 2; syy += (p.p - my) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? clamp((sxy * sxy) / (sxx * syy)) : 1, n,
    at: x => my + slope * (x - mx) };
}

// Confidence from weighted [weight, 0..1] evidence terms.
export const evidence = terms => {
  const w = terms.reduce((s, t) => s + t[0], 0) || 1;
  return Math.round(100 * clamp(terms.reduce((s, t) => s + t[0] * clamp(t[1]), 0) / w));
};

export const volRatio = (bars, n = 20) => {
  const av = sma(bars.map(b => b.v || 0), n);
  const cur = bars[bars.length - 1].v || 0;
  return av ? cur / av : null;
};

// ---- added for VCP (and reused by the Elliott Wave engine) -----------------

// ZigZag: significance-filtered alternating swings. Unlike `pivots` (a fixed 5-bar
// fractal, which yields lots of small noise swings), a leg is only recorded once price
// reverses by `threshold` in absolute price terms — which is what base/contraction and
// wave segmentation need. Returns alternating [{ i, p, kind:'H'|'L' }], oldest-first.
// `minGap` (bars) is not optional in practice: without it a single bar can close one
// swing and open the next, producing degenerate pivots on adjacent indices and a stream
// of meaningless micro-legs. Pivots must be at least `minGap` bars apart to be recorded.
export function zigzag(bars, threshold, minGap = 3) {
  if (!bars.length || !(threshold > 0)) return [];
  const out = [];
  let dir = 0;                                   // +1 = advancing, -1 = declining, 0 = undecided
  let hiI = 0, hiP = bars[0].h, loI = 0, loP = bars[0].l;

  // Pivots alternate by construction. A confirmed pivot closer than `minGap` to the
  // previous one of the SAME kind replaces it when more extreme, rather than being
  // appended — otherwise one bar could both close a swing and open the next.
  const push = (i, p, kind) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) {
      if (kind === 'H' ? p >= last.p : p <= last.p) { last.i = i; last.p = p; }
      return;
    }
    if (last && i - last.i < minGap) {
      // Genuine reversal but too soon: drop the previous pivot and keep this one only if
      // it is the more meaningful extreme, so the sequence stays clean.
      if (kind === 'H' ? p >= last.p : p <= last.p) out.pop(); else return;
    }
    out.push({ i, p, kind });
  };

  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];
    if (h > hiP) { hiP = h; hiI = i; }
    if (l < loP) { loP = l; loI = i; }

    if (dir >= 0 && hiP - l >= threshold) {       // reversal down confirmed off the high
      push(hiI, hiP, 'H');
      dir = -1; loP = l; loI = i;
    } else if (dir <= 0 && h - loP >= threshold) { // reversal up confirmed off the low
      push(loI, loP, 'L');
      dir = 1; hiP = h; hiI = i;
    }
  }
  // The in-progress swing matters at the right edge (it is the live contraction / wave).
  const kind = dir >= 0 ? 'H' : 'L';
  const [i, p] = dir >= 0 ? [hiI, hiP] : [loI, loP];
  const last = out[out.length - 1];
  if (!last || (last.kind !== kind && i > last.i)) out.push({ i, p, kind, provisional: true });
  return out;
}

// Wilder RSI. Used for the VCP momentum check and Elliott wave-5 divergence.
export function rsi(bars, n = 14) {
  if (bars.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d >= 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  for (let i = n + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

// Slope of a series over the last `n` bars, as % of its starting value. Used for the
// Minervini "200-MA trending up for at least a month" criterion.
export function slopePct(series, n) {
  const a = series[series.length - 1 - n], b = series[series.length - 1];
  return (a == null || b == null || !a) ? null : (b - a) / Math.abs(a) * 100;
}
