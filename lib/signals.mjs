// lib/signals.mjs — pure parser: TradingView legend rows -> structured intraday signals.
// Heuristic only (reads whatever indicators are already on the chart). No network.
// Everything is derived from real legend values; anything not on the chart is reported
// honestly as null / 'n/a' rather than fabricated.

const num = s => { const m = (s || '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };

// ---- session phase from the symbol's exchange prefix -----------------------
// Only markets we actually know (NSE/BSE -> India, US majors -> New York) get a
// phase; anything else honestly returns null. Phases drive Entry Readiness:
// structure found in the IB/morning is tradeable, midday is chop, the last 45m
// is a no-new-entry window.
const SESSIONS = {
  india: { rx: /^(NSE|BSE):/i, tz: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 },
  usa: { rx: /^(NASDAQ|NYSE|AMEX|BATS|CBOE):/i, tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
};
export function sessionPhase(symbol, now = new Date()) {
  const s = String(symbol || '');
  const m = Object.values(SESSIONS).find(x => x.rx.test(s));
  if (!m) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: m.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = k => parts.find(x => x.type === k)?.value;
  const cur = ((+g('hour')) % 24) * 60 + (+g('minute'));
  const weekend = g('weekday') === 'Sat' || g('weekday') === 'Sun';
  if (weekend || cur < m.open || cur >= m.close) return { phase: 'Closed', minsSinceOpen: null, minsToClose: null, tradeable: false };
  const sinceOpen = cur - m.open, toClose = m.close - cur;
  const phase = toClose <= 45 ? 'Late — no new entries'
    : sinceOpen < 60 ? 'IB (first hour)'
    : sinceOpen < 150 ? 'Morning trend'
    : toClose <= 135 ? 'Power hour' : 'Midday';
  return { phase, minsSinceOpen: sinceOpen, minsToClose: toClose, tradeable: toClose > 45 && phase !== 'Midday' };
}

export function parseSignals(rows = [], chart = {}) {
  const blob = rows.join(' \n ');
  const main = rows[0] || '';

  // OHLC + % change from the main series row. The legend concatenates values with no
  // delimiters, e.g. "O4.9050H4.9050L4.9050C4.90504.9050∅...(0.00%)". O/H/L are cleanly
  // bracketed by letters; use O's decimal precision to cut the close out of the C+price blob.
  const open = num((main.match(/O(-?\d+\.\d+)H/) || [])[1] || '');
  const high = num((main.match(/H(-?\d+\.\d+)L/) || [])[1] || '');
  const low = num((main.match(/L(-?\d+\.\d+)C/) || [])[1] || '');
  let close = null;
  const cRaw = (main.match(/C(-?\d+\.\d+)/) || [])[1];
  if (cRaw) {
    const dec = (String(open ?? '').split('.')[1] || '').length;
    const cut = dec ? cRaw.match(new RegExp('^-?\\d+\\.\\d{' + dec + '}')) : null;
    close = cut ? parseFloat(cut[0]) : num(cRaw);
  }
  const changePct = (() => { const m = main.match(/\(([-+]?\d+(?:\.\d+)?)%\)/); return m ? parseFloat(m[1]) : null; })();

  // indicators (first numeric value after the name)
  const rsi = num((blob.match(/RSI\s*\d*[a-z]*\s*(-?\d+\.\d+)/i) || [])[1] || '');
  const bop = num((blob.match(/Balance of Power\s*(-?\d+\.\d+)/i) || [])[1] || '');
  const vwap = num((blob.match(/VWAP\s*(-?\d+\.\d+)/i) || [])[1] || '');
  const emas = {};
  for (const m of blob.matchAll(/EMA\s*(\d+)\s*[a-z]*\s*(-?\d+\.\d+)/gi)) emas[m[1]] = parseFloat(m[2]);
  const smas = {};
  for (const m of blob.matchAll(/SMA\s*(\d+)\s*[a-z]*\s*(-?\d+\.\d+)/gi)) smas[m[1]] = parseFloat(m[2]);
  // relative volume (if a rVol study is on the chart) — used for volume confirmation
  const rvol = num((blob.match(/(?:relative volume|rvol|rel(?:ative)? vol)\s*[:=]?\s*(-?\d+\.\d+)/i) || [])[1] || '');
  const hasVolumeStudy = /\bvolume\b/i.test(blob);

  // ---- legacy signal list (kept for the existing UI) ------------------------
  const signals = [];
  if (rsi != null) signals.push(rsi >= 70 ? 'RSI overbought' : rsi <= 30 ? 'RSI oversold' : rsi >= 55 ? 'RSI bullish' : rsi <= 45 ? 'RSI bearish' : 'RSI neutral');
  const ema9 = emas['9'], ema21 = emas['21'];
  if (close != null && ema9 != null && ema21 != null) {
    if (close > ema9 && ema9 > ema21) signals.push('Price>EMA9>EMA21 (up stack)');
    else if (close < ema9 && ema9 < ema21) signals.push('Price<EMA9<EMA21 (down stack)');
    else signals.push('EMAs mixed');
  }
  if (bop != null) signals.push(bop > 0 ? 'BoP buyers' : bop < 0 ? 'BoP sellers' : 'BoP flat');
  if (vwap != null && close != null) signals.push(close >= vwap ? 'Above VWAP' : 'Below VWAP');

  // ---- intraday decision metrics --------------------------------------------
  // Tally directional evidence with weights; each is a real, on-chart signal.
  let bull = 0, bear = 0, total = 0;
  const vote = (cond, up, w = 1) => { if (cond == null) return; total += w; if (up) bull += w; else bear += w; };
  if (rsi != null) vote(true, rsi >= 50, 1.0);
  if (ema9 != null && ema21 != null) vote(true, ema9 > ema21, 1.5);           // trend stack (heaviest)
  if (close != null && ema9 != null) vote(true, close > ema9, 1.0);
  if (bop != null) vote(true, bop > 0, 1.0);
  if (vwap != null && close != null) vote(true, close >= vwap, 1.0);
  if (changePct != null) vote(true, changePct >= 0, 0.5);

  const net = bull - bear;
  const marketBias = total === 0 ? 'NEUTRAL' : net > 0.5 ? 'BULLISH' : net < -0.5 ? 'BEARISH' : 'NEUTRAL';
  const longShort = marketBias === 'BULLISH' ? 'LONG' : marketBias === 'BEARISH' ? 'SHORT' : 'NONE';
  // strength = how lopsided the evidence is (0–100)
  const signalStrength = total === 0 ? 0 : Math.round(100 * Math.abs(net) / total);
  const confidence = signalStrength >= 70 ? 'High' : signalStrength >= 45 ? 'Good' : signalStrength > 0 ? 'Fair' : 'None';

  // trend from the EMA stack + price
  let trend = 'Unknown';
  if (ema9 != null && ema21 != null && close != null) {
    if (close > ema9 && ema9 > ema21) trend = 'Up';
    else if (close < ema9 && ema9 < ema21) trend = 'Down';
    else trend = 'Sideways';
  }

  // volume confirmation (honest: only if a volume/rVol study is on the chart)
  let volumeConfirmation;
  if (rvol != null) volumeConfirmation = rvol >= 1.2 ? `Confirmed (rVol ${rvol}×)` : `Weak (rVol ${rvol}×)`;
  else if (hasVolumeStudy) volumeConfirmation = 'On-chart (add rVol to confirm strength)';
  else volumeConfirmation = 'n/a — add a Volume/rVol study';

  // risk level: RSI extremes = chase/reversal risk; large intraday move = elevated
  let riskLevel = 'Moderate';
  if (rsi != null && (rsi >= 75 || rsi <= 25)) riskLevel = 'High';
  else if (changePct != null && Math.abs(changePct) >= 4) riskLevel = 'High';
  else if (signalStrength >= 60 && trend !== 'Sideways') riskLevel = 'Low';

  // best setup (descriptive, from what the chart actually shows)
  let bestSetup = 'No clear setup';
  if (trend === 'Up' && marketBias === 'BULLISH') bestSetup = 'Long — trend continuation / VWAP-EMA pullback';
  else if (trend === 'Down' && marketBias === 'BEARISH') bestSetup = 'Short — trend continuation / VWAP-EMA rejection';
  else if (rsi != null && rsi >= 75) bestSetup = 'Caution — overbought; fade only on rejection';
  else if (rsi != null && rsi <= 25) bestSetup = 'Caution — oversold; long only on reclaim';
  else if (marketBias !== 'NEUTRAL') bestSetup = `${longShort} — momentum, wait for level`;

  // trade quality grade
  const tradeQuality = (signalStrength >= 70 && trend !== 'Sideways' && riskLevel !== 'High') ? 'A'
    : (signalStrength >= 45 && marketBias !== 'NEUTRAL') ? 'B'
    : signalStrength > 0 ? 'C' : '—';

  // location vs value (VWAP as intraday value proxy, scaled by the day range)
  let location = null;
  const range = (high != null && low != null) ? high - low : null;
  if (vwap != null && close != null && range > 0) {
    const rel = (close - vwap) / range;   // signed distance from value, in day-range units
    location = Math.abs(rel) <= 0.25 ? 'At value'
      : rel > 0.6 ? 'Extended above value' : rel < -0.6 ? 'Extended below value'
      : rel > 0 ? 'Above value' : 'Below value';
  }

  // session phase (from the exchange prefix) — gates when a "Ready" makes sense
  const sess = sessionPhase(chart.symbol);

  // avoid-trade reason (if any) + entry readiness
  let avoidReason = null;
  if (total === 0) avoidReason = 'No indicators on the chart to read — add EMA/RSI/BoP/VWAP.';
  else if (sess && sess.phase === 'Closed') avoidReason = 'Market closed — analysis only.';
  else if (sess && sess.phase === 'Late — no new entries') avoidReason = 'Under 45m to close — too late for a new intraday entry.';
  else if (marketBias === 'NEUTRAL') avoidReason = 'Signals conflict (no directional edge).';
  else if (trend === 'Sideways') avoidReason = 'Trend is sideways — choppy, low follow-through.';
  else if (rsi != null && marketBias === 'BULLISH' && rsi >= 78) avoidReason = 'RSI extreme — chasing risk into resistance.';
  else if (rsi != null && marketBias === 'BEARISH' && rsi <= 22) avoidReason = 'RSI extreme — chasing risk into support.';
  else if (location && /^Extended/.test(location) && ((marketBias === 'BULLISH') === /above/.test(location)))
    avoidReason = 'Price extended far from VWAP value — do not chase; wait for a pullback to value.';
  let entryReadiness = avoidReason ? 'Avoid' : (confidence === 'High' && riskLevel !== 'High') ? 'Ready' : 'Wait';
  if (entryReadiness === 'Ready' && sess && sess.phase === 'Midday') entryReadiness = 'Wait';

  // conviction: strength adjusted by trend agreement + volume confirmation (0–100)
  let conviction = signalStrength;
  if (trend !== 'Unknown') conviction += (trend === 'Up') === (marketBias === 'BULLISH') && trend !== 'Sideways' ? 10 : trend === 'Sideways' ? -15 : -10;
  if (rvol != null) conviction += rvol >= 1.5 ? 10 : rvol >= 1.2 ? 5 : -10;
  conviction = Math.max(0, Math.min(100, Math.round(conviction)));

  // one-line verdict — the 2-second read at the top of the card
  const verdict = [
    longShort === 'NONE' ? 'NO TRADE' : longShort,
    location, sess ? sess.phase : null,
    entryReadiness, tradeQuality !== '—' ? `Grade ${tradeQuality}` : null,
  ].filter(Boolean).join(' · ');

  // legacy bias (kept identical semantics for anything relying on it)
  const bias = marketBias;

  return {
    symbol: chart.symbol || null,
    interval: chart.intervalShort || chart.interval || null,
    open, high, low, close, changePct, rsi, bop, vwap, emas, smas,
    bias, signals, studyCount: rows.length,
    // intraday decision metrics
    metrics: {
      marketBias, longShort, signalStrength, confidence, trend,
      volumeConfirmation, riskLevel, bestSetup, tradeQuality,
      entryReadiness, avoidReason,
      conviction, location, verdict,
      sessionPhase: sess ? sess.phase : null,
      minsToClose: sess ? sess.minsToClose : null,
    },
  };
}
