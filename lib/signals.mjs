// lib/signals.mjs — pure parser: TradingView legend rows -> structured signals.
// Heuristic only (reads what indicators are already on the chart). No network.

const num = s => { const m = (s || '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };

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
  const emas = {};
  for (const m of blob.matchAll(/EMA\s*(\d+)\s*[a-z]*\s*(-?\d+\.\d+)/gi)) emas[m[1]] = parseFloat(m[2]);
  const smas = {};
  for (const m of blob.matchAll(/SMA\s*(\d+)\s*[a-z]*\s*(-?\d+\.\d+)/gi)) smas[m[1]] = parseFloat(m[2]);

  // naive bias
  const signals = [];
  if (rsi != null) signals.push(rsi >= 70 ? 'RSI overbought' : rsi <= 30 ? 'RSI oversold' : rsi >= 55 ? 'RSI bullish' : rsi <= 45 ? 'RSI bearish' : 'RSI neutral');
  if (close != null && emas['9'] != null && emas['21'] != null) {
    if (close > emas['9'] && emas['9'] > emas['21']) signals.push('Price>EMA9>EMA21 (up stack)');
    else if (close < emas['9'] && emas['9'] < emas['21']) signals.push('Price<EMA9<EMA21 (down stack)');
    else signals.push('EMAs mixed');
  }
  if (bop != null) signals.push(bop > 0 ? 'BoP buyers' : bop < 0 ? 'BoP sellers' : 'BoP flat');

  const bullish = signals.filter(s => /bullish|up stack|buyers|oversold/.test(s)).length;
  const bearish = signals.filter(s => /bearish|down stack|sellers|overbought/.test(s)).length;
  const bias = bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL';

  return {
    symbol: chart.symbol || null,
    interval: chart.intervalShort || chart.interval || null,
    open, high, low, close, changePct, rsi, bop, emas, smas,
    bias, signals,
    studyCount: rows.length,
  };
}
