// app.js — intraday dashboard frontend. Vanilla JS, no deps.
const $ = s => document.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
const api = (p, opt) => fetch(p, opt).then(r => r.json());

// ---------- reusable filter bar (one factory, every filterable tab reuses it) ----------
// Client-side only: it narrows rows already fetched — never a re-scan, never a provider
// request. `controls` is a declarative spec so no tab duplicates filter logic:
//   { key, label, type:'select'|'text', options:[{v,label}], test(row,val), default, placeholder }
// A select whose value is 'all' (or a text value of '') passes everything, so each `test`
// only has to describe the narrowing case. Selections persist in localStorage under the
// prefix so a filter survives an auto-refresh cycle and a page reload (intraday continuity).
function makeFilterBar(prefix, controls, onChange) {
  const KEY = 'fb:' + prefix;
  const def = c => c.default != null ? c.default : (c.type === 'text' ? '' : 'all');
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const state = {}; controls.forEach(c => { state[c.key] = saved[c.key] != null ? saved[c.key] : def(c); });
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

  const wrap = el('div', 'filterbar');
  const inputs = {};
  let touched = false;   // gates the live-region announcement to user-driven changes
  controls.forEach(c => {
    const lab = el('label', 'fpill');
    lab.append(el('span', 'fk', c.label));
    let input;
    if (c.type === 'text') {
      input = el('input'); input.type = 'search'; input.className = 'finput';
      input.placeholder = c.placeholder || ''; input.spellcheck = false; input.autocomplete = 'off';
      input.value = state[c.key];
      input.addEventListener('input', () => { state[c.key] = input.value; touched = true; persist(); onChange && onChange(); });
    } else {
      input = el('select');
      c.options.forEach(o => { const op = el('option'); op.value = o.v; op.textContent = o.label; input.append(op); });
      input.value = state[c.key];
      input.addEventListener('change', () => { state[c.key] = input.value; touched = true; persist(); onChange && onChange(); });
    }
    inputs[c.key] = input; lab.append(input); wrap.append(lab);
  });
  // Ten controls persist in localStorage. A Min EQ of 65 left set yesterday reads as
  // an empty market today, and the aggregate "N of M shown" does not say which
  // control is responsible. Mark the ones that are actually doing something.
  const markSet = () => controls.forEach(c =>
    inputs[c.key].parentElement.classList.toggle('is-set', state[c.key] !== def(c)));
  const count = el('span', 'fpill fcount');
  const reset = el('button', 'fbtn', 'Reset');
  reset.addEventListener('click', () => {
    controls.forEach(c => { state[c.key] = def(c); inputs[c.key].value = state[c.key]; });
    touched = true; persist(); onChange && onChange();
  });
  wrap.append(el('span', 'grow'), count, reset);
  markSet();

  return {
    el: wrap,
    matches(row) { return controls.every(c => c.test(row, state[c.key])); },
    apply(rows) { return rows.filter(r => this.matches(r)); },
    active() { return controls.some(c => state[c.key] !== def(c)); },
    setCount(shown, total) {
      markSet();
      count.textContent = (shown === total ? `${total}` : `${shown} of ${total}`) + ' shown';
      count.classList.toggle('filtered', shown !== total);
      if (touched) { touched = false; announce(`${shown} of ${total} rows shown`); }
    },
  };
}
// Common `test` builders so tabs stay declarative.
const F = {
  eq: field => (row, val) => val === 'all' || String(row[field] ?? '') === val,
  min: field => (row, val) => val === 'any' || (row[field] != null && Number(row[field]) >= Number(val)),
  has: field => (row, val) => !val || String(row[field] ?? '').toUpperCase().includes(val.trim().toUpperCase()),
  // Numeric column filter. Accepts:  >100  >=100  <50  <=50  ·  50-200 (inclusive range)
  //  ·  a bare number → treated as a minimum. Unparseable input passes everything (never
  // silently hides a column). Powers the per-column LTP / Entry / SL price filters.
  range: field => (row, val) => {
    let s = String(val ?? '').trim().replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[–—]/g, '-');
    if (!s) return true;
    const n = Number(row[field]);
    if (!isFinite(n)) return false;
    let m;
    if ((m = s.match(/^([<>]=?)\s*(\d+(?:\.\d+)?)$/))) {
      const x = Number(m[2]);
      return m[1] === '>' ? n > x : m[1] === '>=' ? n >= x : m[1] === '<' ? n < x : n <= x;
    }
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) {
      const lo = Number(m[1]), hi = Number(m[2]);
      return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
    }
    if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return n >= Number(m[1]);
    return true;
  },
};


// ---------- reusable column sort (one factory, every data table reuses it) ----------
// Client-side only, exactly like the filter bar: it reorders rows the scan already
// returned. It never re-fetches and never touches the server's ranking logic — which
// is why the third click restores that ranking rather than leaving you stranded in an
// alphabetical view of a conviction-ordered scan.
//
// `spec` is one entry per <th>, positionally. `null` = not sortable. Otherwise:
//   { key }                 numeric column, read row[key]
//   { key, type:'text' }    collator-compared
//   { val: row => x }       computed value (targets[0], a composite, ...)
//   { order:[...] }         categorical: sorted by position in the list, not A–Z,
//                           because VALID before EXPIRED is the useful order and
//                           "ARMED, EXPIRED, EXTENDED, INVALID, TARGET, VALID" is not.
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function makeSortable(prefix, table, spec, onChange) {
  const KEY = 'sort:' + prefix;
  const head = table.tHead && table.tHead.rows[0];
  if (!head) return { apply: r => r };
  const ths = [...head.cells];
  let state = (() => {
    try { const v = JSON.parse(localStorage.getItem(KEY)); return v && spec[v.i] ? v : { i: -1, dir: 0 }; }
    catch { return { i: -1, dir: 0 }; }
  })();

  const numOf = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(/[^0-9.+-]/g, ''));
    return isFinite(n) ? n : null;
  };
  const valueOf = (row, c) => (c.val ? c.val(row) : row[c.key]);

  function compare(a, b, c) {
    const av = valueOf(a, c), bv = valueOf(b, c);
    // A missing value is not "smallest" — it is unknown, and an unknown never
    // deserves the top of a list a trader is scanning. Blanks sink either way.
    const aEmpty = av == null || av === '' || av === '—';
    const bEmpty = bv == null || bv === '' || bv === '—';
    if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
    if (c.order) {
      const ai = c.order.indexOf(String(av)), bi = c.order.indexOf(String(bv));
      return (ai < 0 ? c.order.length : ai) - (bi < 0 ? c.order.length : bi);
    }
    if (c.type === 'text') return COLLATOR.compare(String(av), String(bv));
    const an = numOf(av), bn = numOf(bv);
    if (an == null || bn == null) return an == null && bn == null ? 0 : an == null ? 1 : -1;
    return an - bn;
  }

  function paintHeaders() {
    ths.forEach((th, i) => {
      if (!spec[i]) return;
      const on = state.i === i && state.dir !== 0;
      th.setAttribute('aria-sort', !on ? 'none' : state.dir === 1 ? 'ascending' : 'descending');
      th.classList.toggle('sorted', on);
      th.classList.toggle('sort-asc', on && state.dir === 1);
    });
  }

  function cycle(i) {
    // Categorical and text columns read best ascending first (A first, VALID first);
    // a number a trader sorts by — R:R, EQ, score — is wanted largest-first.
    const firstDir = spec[i].order || spec[i].type === 'text' ? 1 : -1;
    if (state.i !== i) state = { i, dir: firstDir };
    else if (state.dir === firstDir) state = { i, dir: -firstDir };
    else state = { i: -1, dir: 0 };          // back to the server's own ranking
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    paintHeaders();
    const c = state.dir === 0 ? null : spec[state.i];
    announce(!c ? 'Sorted by scan rank'
      : `Sorted by ${ths[state.i].textContent.trim() || 'column'}, ${state.dir === 1 ? 'ascending' : 'descending'}`);
    onChange && onChange();
  }

  ths.forEach((th, i) => {
    if (!spec[i]) return;
    th.classList.add('sortable');
    th.tabIndex = 0;
    th.setAttribute('role', 'columnheader');
    th.setAttribute('aria-sort', 'none');
    th.title = (th.title ? th.title + ' — ' : '') + 'Sort by this column (third click restores scan rank)';
    th.addEventListener('click', () => cycle(i));
    th.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(i); }
    });
  });
  paintHeaders();

  return {
    // Stable: equal values keep the order they arrived in, which is the scan's rank.
    apply(rows) {
      if (state.dir === 0 || !spec[state.i]) return rows;
      const c = spec[state.i], d = state.dir;
      return rows.map((r, i) => [r, i])
        .sort((x, y) => compare(x[0], y[0], c) * d || x[1] - y[1])
        .map(x => x[0]);
    },
  };
}

// Shared column vocabularies, so the same concept sorts the same way on every tab.
const ORD = {
  state: ['VALID', 'ARMED', 'EXTENDED', 'TARGET', 'INVALID', 'EXPIRED'],
  confidence: ['High', 'Good', 'Fair'],
  signal: ['LONG', 'SHORT'],
  tier: ['CONFIRMED', 'PRE-BREAKOUT', 'WATCH'],
  readiness: ['AT PIVOT', 'NEAR', 'APPROACHING'],
  status: ['Confirmed', 'Developing', 'Failed'],
  outcome: ['WIN', 'SCRATCH', 'LOSS'],
};
const T1 = r => (Array.isArray(r.targets) ? r.targets[0] : null);


// ---------- shared presentation helpers ----------
// One empty/loading/error vocabulary for every tab. Previously each site wrote a
// bare line of dim 12px text ("Loading…", "Failed: " + msg) that read as a
// caption rather than a state, and the layout collapsed while data was in
// flight. A state is a surface: it occupies the space the data will take.
const esc0 = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function stateBlock({ icon = '·', title, body = '', kind = '', actions = '' }) {
  return `<div class="state-block ${kind}">`
    + `<div class="sb-icon" aria-hidden="true">${icon}</div>`
    + `<div class="sb-title">${title}</div>`
    + (body ? `<p>${body}</p>` : '')
    + (actions ? `<div class="sb-actions">${actions}</div>` : '')
    + `</div>`;
}
const emptyRow = (cols, opts) => `<tr><td colspan="${cols}" class="table-state">${stateBlock(opts)}</td></tr>`;
// Skeleton rows show the shape of the answer while a 3,000-name universe scan
// runs, instead of blanking the table.
function skeletonRows(cols, n = 8) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<tr class="skelrow">' + Array.from({ length: cols }, (_, c) =>
      `<td><span class="skel" style="width:${c === 0 ? 70 : 30 + ((i * 7 + c * 13) % 45)}%"></span></td>`).join('') + '</tr>';
  }
  return out;
}
// One polite announcement channel. Scan progress, result counts and failures were
// visible-only; a screen-reader user got a silent table that changed under them.
// Repeated identical text is re-announced by appending a zero-width space, because
// setting the same string twice is a no-op for most ATs.
let _srLast = '';
function announce(msg) {
  const box = document.getElementById('sr-live');
  if (!box || !msg) return;
  box.textContent = msg === _srLast ? msg + '\u200b' : msg;
  _srLast = msg;
}

// Every analysis table is assembled as one innerHTML string whose leading row(s)
// are header rows. Assigned straight to a <table>, that header <tr> lands inside the
// implicit <tbody> — so `.dtable tbody tr:nth-child(even)` striped from the header
// (every stripe on these tables was off by one), `tbody tr:hover` made the header
// light up like data, and screen readers got no column-header association. Same
// string in; header rows routed to a real <thead>.
function renderTable(table, html) {
  if (!table) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = '<table>' + (html || '') + '</table>';
  const thead = table.tHead || table.createTHead();
  const tbody = table.tBodies[0] || table.createTBody();
  thead.replaceChildren(); tbody.replaceChildren();
  let inHead = true;
  [...tpl.content.querySelector('table').rows].forEach(tr => {
    // The header is the leading run of all-<th> rows; the first row carrying a <td>
    // (data, or a full-width "no data" cell) ends it.
    if (inHead && !tr.querySelector('td')) thead.append(tr);
    else { inHead = false; tbody.append(tr); }
  });
}

// Scan header: label-over-value stats, so "31 setups" outranks "universe 3150".
// Replaces the flat run of equally-weighted tags the meta line used to print.
function statStrip(host, stats) {
  host.innerHTML = stats.filter(Boolean).map(st =>
    `<div class="stat ${st.cls || ''}">`
    + `<span class="sk">${esc0(st.k)}</span>`
    + `<span class="sv ${st.tone || ''}">${st.dot ? '<span class="dot"></span>' : ''}${esc0(st.v)}</span>`
    + `</div>`).join('');
}
// Theme. Dark is the product's identity and stays the default — the OS
// preference is deliberately not consulted, so a light-mode desktop never
// repaints a trading terminal without the trader asking for it. The choice is
// per browser and applied before first paint by the inline bootstrap in <head>.
function applyTheme(mode) {
  // Suppress the 120ms colour transitions for the flip itself — otherwise every
  // row, badge and button cross-fades independently and the swap looks like a
  // repaint bug rather than a mode change.
  const r = document.documentElement;
  r.classList.add('theme-switching');
  requestAnimationFrame(() => requestAnimationFrame(() => r.classList.remove('theme-switching')));
  r.dataset.theme = mode;
  try { localStorage.setItem('theme', mode); } catch {}
  const b = document.getElementById('theme');
  if (b) b.setAttribute('aria-label', mode === 'light' ? 'Switch to dark' : 'Switch to light');
}
addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('theme');
  if (!b) return;
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  b.addEventListener('click', () =>
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
});

// Keeps sticky table headers below the sticky app header rather than under it —
// `top:0` parked them behind the two header rails.
function syncStickyTop() {
  const h = document.querySelector('header');
  if (h) document.documentElement.style.setProperty('--stick-top', h.offsetHeight + 'px');
}
addEventListener('resize', syncStickyTop);
addEventListener('DOMContentLoaded', syncStickyTop);
syncStickyTop();

let CONFIG = null, POLL_MS = 7000, timer = null;
// Freshness of the live panel. A trading surface must never present a number it
// can no longer refresh as if it were current.
let lastGoodPoll = 0, pollFailures = 0, freshTimer = null;
// Symbol under analysis, shared by the three analysis tabs so switching methodology keeps
// you on the same name (and reuses the server-side history cache). Set only by you.
let SELECTED_SYMBOL = '';
// Symbol the Dashboard's Signal Summary is showing. Empty until you load one — the panel
// no longer follows whichever TradingView chart happens to be fronted.
let DASHBOARD_SYMBOL = '';

// ---------- init ----------
(async function init() {
  CONFIG = await api('/api/config').catch(() => null);
  if (CONFIG) {
    POLL_MS = (CONFIG.pollSeconds || 7) * 1000;
    renderMarket('india', CONFIG.markets.india_intraday);
  }
  $('#autopoll').addEventListener('change', e => e.target.checked ? start() : stop());
  start();
})();

function start() { poll(); timer = setInterval(poll, POLL_MS); }
function stop() { clearInterval(timer); timer = null; }

// ---------- poll loop ----------
async function poll() {
  let snap = null;
  try { snap = await api('/api/snapshot'); } catch {}
  if (snap) {
    lastGoodPoll = Date.now(); pollFailures = 0;
    renderHealth(snap.status);
    renderSignals(snap.signals, snap.chart);
    renderScans(snap.watchlist || []);
  } else {
    // Deliberately do NOT re-render the signal panel. Blanking it on a dropped poll
    // threw away the last real read and left the "no symbol" block in its place;
    // the last known numbers plus an explicit age is the more useful honest answer.
    pollFailures++;
    renderHealth({ up: false });
  }
  markFreshness();
}

// Runs on every poll and once a second in between, so the age keeps counting up
// rather than freezing at whatever it was when the last request failed.
function markFreshness() {
  const pill = $('#pill-updated'), bar = $('#sig-stale');
  if (!lastGoodPoll) { if (pill) pill.textContent = 'updated —'; return; }
  const ageSec = Math.round((Date.now() - lastGoodPoll) / 1000);
  const stale = pollFailures > 0 || Date.now() - lastGoodPoll > POLL_MS * 3;
  if (pill) {
    pill.textContent = 'updated ' + new Date(lastGoodPoll).toLocaleTimeString();
    pill.classList.toggle('stale', stale);
  }
  if (!bar) return;
  bar.classList.toggle('hidden', !stale);
  if (stale) {
    bar.innerHTML = `\u26a0 Live data is <b>${ageSec}s</b> old — `
      + (pollFailures ? `the last ${pollFailures} update${pollFailures > 1 ? 's' : ''} failed. ` : 'no update has arrived. ')
      + 'The numbers below are the last real read, not the current market.';
  }
}
addEventListener('DOMContentLoaded', () => {
  clearInterval(freshTimer);
  freshTimer = setInterval(markFreshness, 1000);
});

// ---------- health ----------
function renderHealth(st = {}) {
  const cdp = $('#pill-cdp');
  cdp.textContent = st.up ? 'CDP up' : 'CDP down';
  cdp.className = 'pill ' + (st.up ? 'ok' : 'bad');
  $('#pill-app').textContent = st.app || '—';
  $('#pill-tabs').textContent = 'tabs ' + (st.chartTabs ?? '—');
  const tb = $('#health-kv tbody'); tb.innerHTML = '';
  const rows = [['Status', st.up ? 'connected' : 'not connected'], ['Endpoint', st.endpoint || '—'], ['App', st.app || '—'], ['Browser', st.browser || '—'], ['Chart tabs', st.chartTabs ?? 0]];
  rows.forEach(([k, v]) => { const tr = el('tr'); tr.append(el('td', '', k), el('td', '', String(v))); tb.append(tr); });
  $('#health-hint').textContent = st.up ? '' : 'Run:  npm run tv:debug   (launches TradingView with CDP on :9222)';
}

// Decision tiles are patched, never rebuilt. The panel repaints every 7s and the
// old `host.innerHTML = ''` threw away twelve tiles to change one number: it lost
// any text selection mid-read, and — worse for a live panel — gave no indication of
// which value had actually moved. Now only changed values are written, and only a
// changed value flashes.
function upsertTiles(host, specs) {
  if (!host) return;
  const live = specs.filter(t => t && t.v != null && t.v !== '');
  const keep = new Set(live.map(t => t.k));
  live.forEach(({ k, v, cls }) => {
    let tile = [...host.children].find(x => x.dataset.k === k);
    const first = !tile;
    if (first) {
      tile = el('div', 'dtile');
      tile.dataset.k = k;
      tile.append(el('div', 'dk', k), el('div', 'dv', ''));
    }
    const dv = tile.lastElementChild, next = String(v);
    const changed = !first && dv.textContent !== next;
    if (dv.textContent !== next) dv.textContent = next;
    tile.className = 'dtile' + (cls ? ' ' + cls : '');
    if (changed) { tile.classList.remove('flash'); void tile.offsetWidth; tile.classList.add('flash'); }
    host.append(tile);        // re-append keeps spec order without recreating nodes
  });
  [...host.children].forEach(t => { if (!keep.has(t.dataset.k)) t.remove(); });
}

// ---------- signal summary ----------
function renderSignals(s, chart) {
  const bare = x => String(x || '').split(':').pop().trim().toUpperCase().replace(/\s+/g, '');
  if (!DASHBOARD_SYMBOL) {
    $('#signal-empty').innerHTML = stateBlock({ icon: '◎', title: 'No symbol loaded',
      body: 'Type a symbol above and press <b>Load</b>. The Signal Summary reads that exact symbol from your TradingView chart — it deliberately does not follow whichever chart tab happens to be fronted.' });
    $('#signal-empty').classList.remove('hidden'); $('#signal-body').classList.add('hidden');
    return;
  }
  if (!s) { $('#signal-empty').classList.remove('hidden'); $('#signal-body').classList.add('hidden'); return; }
  // The chart switcher is best-effort, so never present another symbol's legend as
  // the one you asked for.
  if (chart && bare(chart.symbol) !== bare(DASHBOARD_SYMBOL)) {
    $('#signal-empty').innerHTML = stateBlock({ kind: 'warn', icon: '◔', title: `Waiting for TradingView to load ${esc0(DASHBOARD_SYMBOL)}`,
      body: `The chart currently shows <b>${esc0(chart.symbol || '—')}</b>. Bring a chart tab to the front and press <b>Load</b> again.` });
    $('#signal-empty').classList.remove('hidden'); $('#signal-body').classList.add('hidden');
    return;
  }
  $('#signal-empty').classList.add('hidden'); $('#signal-body').classList.remove('hidden');
  $('#sig-sym').textContent = s.symbol || '—';
  $('#sig-tf').textContent = s.interval || '';
  const b = $('#sig-bias'); b.textContent = s.bias; b.className = 'bias ' + s.bias;
  $('#sig-close').textContent = s.close != null ? s.close : '—';
  const chg = $('#sig-chg');
  if (s.changePct != null) { chg.textContent = (s.changePct > 0 ? '+' : '') + s.changePct + '%'; chg.className = 'chg ' + (s.changePct >= 0 ? 'up' : 'down'); }
  else chg.textContent = '';

  // intraday decision metrics
  const d = $('#sig-decision'), dp = $('#sig-primary');
  const m = s.metrics || {};
  // one-line verdict — the 2-second read
  const v = $('#sig-verdict');
  if (v) {
    v.textContent = m.verdict || '';
    v.className = 'verdict ' + (m.entryReadiness === 'Ready' ? 'good' : m.entryReadiness === 'Avoid' ? 'bad' : 'warn');
  }
  const biasCls = m.marketBias === 'BULLISH' ? 'good' : m.marketBias === 'BEARISH' ? 'bad' : 'warn';
  // The verdict: what you decide from. Everything below is the evidence for it.
  upsertTiles(dp, [
    { k: 'Entry Readiness', v: m.entryReadiness, cls: m.entryReadiness === 'Ready' ? 'good' : m.entryReadiness === 'Avoid' ? 'bad' : 'warn' },
    { k: 'Market Bias', v: m.marketBias, cls: biasCls },
    { k: 'Trade Quality', v: m.tradeQuality, cls: m.tradeQuality === 'A' ? 'good' : m.tradeQuality === '\u2014' ? 'warn' : '' },
    m.avoidReason ? { k: '\u26a0 Avoid Trade', v: m.avoidReason, cls: 'wide bad' } : null,
  ]);
  upsertTiles(d, [
    { k: 'Long / Short', v: m.longShort },
    { k: 'Signal Strength', v: m.signalStrength != null ? m.signalStrength + '/100' : null },
    { k: 'Confidence', v: m.confidence, cls: m.confidence === 'High' ? 'good' : m.confidence === 'None' ? 'warn' : '' },
    { k: 'Conviction', v: m.conviction != null ? m.conviction + '/100' : null, cls: m.conviction >= 70 ? 'good' : m.conviction < 40 ? 'warn' : '' },
    { k: 'Trend', v: m.trend, cls: m.trend === 'Up' ? 'good' : m.trend === 'Down' ? 'bad' : 'warn' },
    { k: 'Location', v: m.location, cls: m.location === 'At value' ? 'good' : /Extended/.test(m.location || '') ? 'bad' : '' },
    { k: 'Session', v: m.sessionPhase, cls: /Late|Closed|Midday/.test(m.sessionPhase || '') ? 'warn' : 'good' },
    { k: 'Volume Confirm', v: m.volumeConfirmation, cls: /Confirmed/.test(m.volumeConfirmation || '') ? 'good' : /Weak|n\/a/.test(m.volumeConfirmation || '') ? 'warn' : '' },
    { k: 'Risk Level', v: m.riskLevel, cls: m.riskLevel === 'Low' ? 'good' : m.riskLevel === 'High' ? 'bad' : 'warn' },
    { k: 'Best Setup', v: m.bestSetup, cls: 'wide' },
  ]);

  const mm = $('#sig-metrics'); mm.innerHTML = '';
  const add = (k, v) => { if (v != null && v !== '') mm.append(el('span', 'm', `<b>${k}</b>${v}`)); };
  add('RSI', s.rsi); add('BoP', s.bop); add('VWAP', s.vwap);
  Object.entries(s.emas || {}).forEach(([k, v]) => add('EMA' + k, v));
  Object.entries(s.smas || {}).forEach(([k, v]) => add('SMA' + k, v));
  add('studies', s.studyCount);
  const list = $('#sig-list'); list.innerHTML = '';
  (s.signals || []).forEach(x => list.append(el('li', '', x)));
}

// ---------- market section (scan + checklist) — India intraday only ----------
function renderMarket(key, m) {
  if (!m) return;
  $(`#${key}-session`).textContent = '· ' + (m.session || '');
  const tfs = $(`#${key}-tfs`); tfs.innerHTML = '';
  // These were .chip — pointer cursor, hover colour shift, accent border — with no
  // click handler anywhere. They state which intraday timeframes this market is read
  // on; they have never been a filter, so they stop advertising one.
  (m.timeframes || []).forEach(tf => tfs.append(el('span', 'chip chip-static', tf)));
  const cl = $(`#${key}-check`); cl.innerHTML = '';
  (m.checklist || []).forEach((item, i) => {
    const id = `chk-${key}-${i}`;
    const li = el('li');
    const cb = el('input'); cb.type = 'checkbox'; cb.id = id;
    cb.checked = localStorage.getItem(id) === '1';
    cb.addEventListener('change', () => localStorage.setItem(id, cb.checked ? '1' : '0'));
    const lab = el('label'); lab.htmlFor = id; lab.textContent = item;
    li.append(cb, lab); cl.append(li);
  });
}

function renderScans(watchlist) {
  fill('india', CONFIG?.markets?.india_intraday?.exchanges || [], watchlist);
  function fill(key, exchanges, list) {
    const ul = $(`#${key}-scan`); if (!ul) return; ul.innerHTML = '';
    const pref = exchanges.map(e => e.replace(':', '') + ':');
    const seen = new Set();
    list.filter(sym => pref.some(p => sym.startsWith(p)) && !seen.has(sym) && seen.add(sym)).forEach(sym => {
      const [ex, name] = sym.includes(':') ? sym.split(':') : ['', sym];
      const li = el('li'); li.title = 'Load ' + sym + ' on the active chart';
      li.append(el('span', '', name), el('span', 'ex', ex));
      li.addEventListener('click', () => switchSymbol(sym));
      ul.append(li);
    });
    if (!ul.children.length) ul.append(el('li', '', '<span class="ex">no symbols — add to a TradingView watchlist</span>'));
  }
}

async function switchSymbol(sym) {
  $('#pill-updated').textContent = 'loading ' + sym + '…';
  const r = await api('/api/chart/symbol', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: sym }) }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) $('#pill-updated').textContent = 'switch failed (experimental)';
  poll();
}

// ---------- tabs + TPO scanners (India + USA share one implementation) ----------
(function wireTabsAndTPO() {
  const views = { start: $('#view-start'), dashboard: $('#view-dashboard'), tpo: $('#view-tpo'), 'tpo-usa': $('#view-tpo-usa'),
    patterns: $('#view-patterns'), vcp: $('#view-vcp'), elliott: $('#view-elliott'),
    brk: $('#view-brk'), brk2: $('#view-brk2'), cache: $('#view-cache'),
    testing: $('#view-testing'), analytics: $('#view-analytics') };
  const tabs = [...document.querySelectorAll('#tabs .tab')];

  // One control-set, reused by both TPO scanners (India + USA) so the filter UX is identical.
  function tpoFilterControls() {
    return [
      { key: 'sig', label: 'Signal', type: 'select', test: F.eq('signal'),
        options: [{ v: 'all', label: 'All' }, { v: 'LONG', label: 'LONG' }, { v: 'SHORT', label: 'SHORT' }] },
      { key: 'state', label: 'State', type: 'select',
        // Actionable = any setup still tradeable this session (VALID in-zone, ARMED waiting,
        // or EXTENDED ran-past-but-live); excludes TARGET / EXPIRED / INVALID. State is
        // normalised so a casing/whitespace drift from the scanner can't silently empty the
        // list. Previously "Actionable" was VALID||ARMED only — EXTENDED (the common live
        // state) was dropped, so the filter returned empty sets during most of the session.
        test: (row, val) => {
          if (val === 'all') return true;
          const s = String(row.state || '').trim().toUpperCase();
          if (val === 'valid') return s === 'VALID';
          return s === 'VALID' || s === 'ARMED' || s === 'EXTENDED';
        },
        options: [{ v: 'all', label: 'All' }, { v: 'act', label: 'Actionable' }, { v: 'valid', label: 'VALID only' }] },
      { key: 'setup', label: 'Setup', type: 'select', test: F.eq('setup'),
        options: [{ v: 'all', label: 'All' }, { v: 'OPEN-DRIVE', label: 'Open-Drive' }, { v: 'IB-COIL', label: 'IB-Coil' }, { v: 'VALUE-EDGE', label: 'Value-Edge' }, { v: 'EXPANSION', label: 'Expansion' }] },
      { key: 'conf', label: 'Confidence', type: 'select', test: F.eq('confidence'),
        options: [{ v: 'all', label: 'All' }, { v: 'High', label: 'High' }, { v: 'Good', label: 'Good' }, { v: 'Fair', label: 'Fair' }] },
      { key: 'ltp', label: 'LTP', type: 'text', placeholder: '>100 · 50-200', test: F.range('ltp') },
      { key: 'entry', label: 'Entry', type: 'text', placeholder: '>100 · 50-200', test: F.range('entry') },
      { key: 'sl', label: 'SL', type: 'text', placeholder: '>100 · 50-200', test: F.range('sl') },
      { key: 'eq', label: 'Min EQ', type: 'select', default: 'any', test: F.min('entryQuality'),
        options: [{ v: 'any', label: 'Any' }, { v: '45', label: '≥45' }, { v: '65', label: '≥65' }] },
      { key: 'rr', label: 'Min R:R', type: 'select', default: 'any', test: F.min('rr'),
        options: [{ v: 'any', label: 'Any' }, { v: '1.5', label: '≥1.5' }, { v: '2', label: '≥2' }, { v: '3', label: '≥3' }] },
      { key: 'sym', label: 'Symbol', type: 'text', placeholder: 'contains…', test: F.has('symbol') },
    ];
  }

  function makeTPO(prefix, endpoint) {
    const id = s => document.getElementById(prefix + '-' + s);
    let tpoMs = 30000, started = false, autoOn = true;
    let cycleTimer = null, tickTimer = null, nextAt = 0, scanning = false;
    let filterBar = null, sorter = null, lastRows = [];

    id('auto').addEventListener('change', e => {
      autoOn = e.target.checked;
      id('auto-wrap').classList.toggle('paused', !autoOn);
      if (autoOn) runScan(); else clearTimeout(cycleTimer);
      tick();
    });
    id('refresh').addEventListener('click', () => runScan());

    function schedule() {
      clearTimeout(cycleTimer);
      if (!autoOn) { nextAt = 0; return; }
      nextAt = Date.now() + tpoMs;
      cycleTimer = setTimeout(runScan, tpoMs);
    }
    function tick() {
      const nx = id('next');
      if (scanning) { nx.textContent = 'refreshing…'; nx.classList.remove('paused'); return; }
      if (!autoOn) { nx.textContent = 'paused'; nx.classList.add('paused'); return; }
      nx.classList.remove('paused');
      nx.textContent = 'next in ' + Math.max(0, Math.round((nextAt - Date.now()) / 1000)) + 's';
    }
    async function runScan() {
      if (scanning) return;
      scanning = true; clearTimeout(cycleTimer); tick();
      try { await scan(); } finally { scanning = false; schedule(); tick(); }
    }

    async function scan() {
      const meta = id('meta'), body = id('body'), note = id('note');
      if (!lastRows.length) body.innerHTML = skeletonRows(13);
      body.parentElement.classList.add('is-busy');
      statStrip(meta, [{ k: 'status', v: 'scanning…', cls: 'status-delayed' }]);
      let r;
      try { r = await api(endpoint); } catch (e) {
        body.parentElement.classList.remove('is-busy');
        statStrip(meta, [{ k: 'status', v: 'scan failed', cls: 'status-delayed' }]);
        body.innerHTML = emptyRow(13, { kind: 'err', icon: '⚠', title: 'Scan request failed', body: esc0(e.message) + ' — the server may not be running. Auto-refresh will retry on the next cycle.' });
        announce('Scan request failed. ' + e.message);
        return;
      }
      body.parentElement.classList.remove('is-busy');
      if (r.error) {
        statStrip(meta, [{ k: 'status', v: 'scan error', cls: 'status-delayed' }]);
        body.innerHTML = emptyRow(13, { kind: 'err', icon: '⚠', title: 'Scan error', body: esc0(r.error) });
        announce('Scan error. ' + r.error);
        return;
      }
      const st = r.dataStatus || 'unknown';
      const stLabel = st === 'live' ? 'LIVE' : st === 'delayed' ? ('DELAYED' + (r.delayMin ? ' ~' + r.delayMin + 'm' : '')) : st === 'closed' ? 'MARKET CLOSED' : '—';
      const rows0 = r.rows || [];
      // The two numbers a trader acts on lead the strip; context follows.
      const actionable = rows0.filter(x => x.state === 'VALID' || x.state === 'ARMED').length;
      const longs = rows0.filter(x => x.signal === 'LONG').length;
      statStrip(meta, [
        { k: 'feed', v: stLabel, cls: 'status-' + st, dot: true },
        { k: 'setups', v: r.count },
        { k: 'actionable', v: actionable, tone: actionable ? 'up' : 'mut' },
        { k: 'long / short', v: longs + ' / ' + (rows0.length - longs) },
        r.indexChangePct != null && { k: r.indexLabel || 'index', v: (r.indexChangePct >= 0 ? '+' : '') + r.indexChangePct + '%', tone: r.indexChangePct >= 0 ? 'up' : 'down' },
        { k: 'universe', v: r.universe, tone: 'mut' },
        r.session && r.session.minsToClose != null && { k: 'to close', v: r.session.minsToClose + 'm', tone: 'mut' },
        { k: 'updated', v: new Date(r.ts).toLocaleTimeString(), tone: 'mut', cls: 'grow' },
      ]);
      lastRows = rows0;
      note.textContent = r.note || '';
      announce(`${stLabel} feed. ${r.count} setups, ${actionable} actionable.`);
      paintRows();
    }

    // Split from scan() so the filter bar can repaint without a re-fetch: it narrows the
    // frozen set that Stage 1 already returned — no provider request, entries never move.
    function paintRows() {
      const body = id('body');
      const total = lastRows.length;
      if (!total) {
        if (filterBar) filterBar.setCount(0, 0);
        body.innerHTML = emptyRow(13, { icon: '○', title: 'No high-quality setups right now',
          body: 'Either nothing clears the conviction, R:R and rVol thresholds, or the market is closed. An empty table is an honest answer — thresholds live in <code>config/markets.json → tpo</code>.' });
        return;
      }
      let rows = filterBar ? filterBar.apply(lastRows) : lastRows;
      if (filterBar) filterBar.setCount(rows.length, total);
      if (sorter) rows = sorter.apply(rows);       // filter first, then order
      if (!rows.length) {
        body.innerHTML = emptyRow(13, { icon: '⊘', kind: 'warn', title: `All ${total} setups are hidden by your filters`,
          body: 'Press <b>Reset</b> on the filter bar above to see them again.' });
        return;
      }
      body.innerHTML = '';
      rows.forEach(x => {
        const tr = el('tr');
        const zone = Array.isArray(x.entryZone) ? `<div class="ezone">zone ${esc0(x.entryZone[0])}–${esc0(x.entryZone[1])}</div>` : '';
        const cap = x.circuit && x.circuit.capped ? ' <span class="capped" title="Target/SL clamped to circuit band">⛒</span>' : '';
        // Escaped like every other table in this file. These fields come from the
        // server, but the breakout tabs route the identical fields through esc() and
        // one table quietly interpolating raw markup is the kind of inconsistency
        // that stops being harmless the moment a field's provenance changes.
        const at = v => String(v == null ? '' : v).replace(/"/g, '&quot;');
        tr.innerHTML = `
          <td class="sym">${esc0(x.symbol)}</td>
          <td class="num">${esc0(x.ltp)}</td>
          <td><span class="sig ${at(x.signal)}">${esc0(x.signal)}</span></td>
          <td><span class="setup setup-${at(x.setup || '')}">${esc0(x.setup || '—')}</span></td>
          <td><span class="st st-${at(x.state)}" title="${at(x.stateNote)}">${esc0(x.state)}</span><div class="ttime">${esc0(x.triggerTime || '')}</div></td>
          <td class="num">${esc0(x.entry)}${zone}</td>
          <td class="num">${esc0(x.sl)}</td>
          <td class="num">${(x.targets || []).map(esc0).join(' / ')}${cap}</td>
          <td class="num rr">${esc0(x.rr)}</td>
          <td class="num"><span class="eq ${x.entryQuality >= 65 ? 'good' : x.entryQuality < 45 ? 'low' : ''}">${esc0(x.entryQuality ?? '—')}</span></td>
          <td><span class="conf ${at(x.confidence)}">${esc0(x.confidence)} · ${esc0(x.score)}</span></td>
          <td class="reason" title="${at(x.reason)}"><span class="clamp">${esc0(x.reason)}</span></td>`;
        const td = el('td'), b = el('button', 'btn-confirm', 'Confirm');
        b.title = 'Load on chart & read live on-chart levels + real circuit';
        b.addEventListener('click', () => confirm(x, b));
        td.append(b); tr.append(td); body.append(tr);
      });
    }

    async function confirm(x, btn) {
      const box = id('confirm'); const old = btn.textContent;
      const symbol = x.ticker || x.symbol;
      btn.disabled = true; btn.textContent = '…';
      box.classList.remove('hidden');
      box.innerHTML = `<h3>Confirming ${symbol} on chart…</h3>`;
      const plan = { signal: x.signal, entry: x.entry, sl: x.sl, targets: x.targets };
      let r;
      try { r = await api('/api/tpo/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol, plan }) }); }
      catch (e) { box.innerHTML = `<h3>${symbol}</h3><div class="prow">Confirm failed: ${e.message}</div>`; btn.disabled = false; btn.textContent = old; return; }
      btn.disabled = false; btn.textContent = old;

      const lines = [];
      if (r.ok) {
        const L = r.live || {};
        lines.push(`chart: ${r.chartSymbol || symbol} · ${r.interval || ''}`);
        lines.push(`live OHLC: O ${L.open ?? '—'}  H ${L.high ?? '—'}  L ${L.low ?? '—'}  C ${L.close ?? '—'}  (${L.changePct ?? '—'}%)`);
        (r.profileRows || []).forEach(p => lines.push(p));
      } else if (r.error) {
        lines.push('chart: ' + r.error);
      }

      // real circuit block (India)
      let circ = '';
      if (r.circuit) {
        if (r.circuit.ok) {
          const a = r.adjusted;
          circ = `<div class="circ ok"><b>Real NSE circuit (NSE data provider):</b> lower ${r.circuit.lower} · upper ${r.circuit.upper}`
            + (a ? ` → validated plan: entry ${a.entry} · SL ${a.sl} · targets ${a.targets.join(' / ')} · R:R ${a.rr}${a.capped ? ' <span class="capped">⛒ capped to circuit</span>' : ' (within circuit)'}` : '')
            + `</div>`;
        } else {
          circ = `<div class="circ warn"><b>Real circuit unavailable:</b> ${r.circuit.error} Using the assumed band from the scan.</div>`;
        }
      }

      box.innerHTML = `<h3>${r.chartSymbol || symbol} — on-chart confirm</h3>`
        + lines.map(l => `<div class="prow">${l}</div>`).join('')
        + circ
        + `<div class="hint">${r.note || ''}</div>`;
    }

    return {
      async start() {
        if (started) return; started = true;
        if (!filterBar) { filterBar = makeFilterBar(prefix, tpoFilterControls(), paintRows); id('filters').append(filterBar.el); }
        if (!sorter) sorter = makeSortable(prefix, id('table'), [
          { key: 'symbol', type: 'text' }, { key: 'ltp' }, { order: ORD.signal, key: 'signal' },
          { key: 'setup', type: 'text' }, { order: ORD.state, key: 'state' },
          { key: 'entry' }, { key: 'sl' }, { val: T1 }, { key: 'rr' }, { key: 'entryQuality' },
          // The cell reads "High · 87": rank by the confidence band first, then by the
          // score inside it, so the sort matches what the column actually shows.
          { val: r => (ORD.confidence.indexOf(r.confidence) + 1 || 9) * 1000 - (Number(r.score) || 0) },
          null, null,
        ], paintRows);
        try {
          const c = await api('/api/config');
          if (c?.tpo?.refreshSeconds) { tpoMs = c.tpo.refreshSeconds * 1000; id('cycle').textContent = 'every ' + c.tpo.refreshSeconds + 's'; }
        } catch {}
        autoOn = id('auto').checked;
        runScan();
        clearInterval(tickTimer); tickTimer = setInterval(tick, 1000); tick();
      },
      stop() { started = false; clearTimeout(cycleTimer); cycleTimer = null; clearInterval(tickTimer); tickTimer = null; },
    };
  }

  // ---------- Testing tab (forward-test journal + India 1-min backtest) ----------
  function makeTesting() {
    const fmt = x => x == null ? '—' : x;
    let filterBar = null, sorter = null, lastRecent = [];
    function paintRecent() {
      let rows = filterBar ? filterBar.apply(lastRecent) : lastRecent;
      if (filterBar) filterBar.setCount(rows.length, lastRecent.length);
      if (sorter) rows = sorter.apply(rows);       // filter first, then order
      $('#test-body').innerHTML = rows.map(t => `
        <tr><td>${t.date}</td><td>${t.market}</td><td class="sym">${t.symbol}</td>
        <td><span class="setup setup-${t.setup}">${t.setup}</span></td>
        <td><span class="sig ${t.signal}">${t.signal}</span></td>
        <td class="num">${t.entry}</td><td class="num">${t.sl}</td><td class="num">${t.targets?.[0] ?? '—'}</td>
        <td class="num">${t.rr}</td><td class="num">${fmt(t.entryQuality)}</td>
        <td>${t.status}</td><td>${t.outcome || (t.status === 'MISSED' ? 'never filled' : '—')}</td>
        <td class="num ${t.rMultiple > 0 ? 'rr' : ''}">${t.rMultiple != null ? (t.rMultiple > 0 ? '+' : '') + t.rMultiple : '—'}</td></tr>`).join('')
        || (lastRecent.length
          ? emptyRow(13, { icon: '⊘', kind: 'warn', title: `All ${lastRecent.length} plans are hidden by your filters`, body: 'Press <b>Reset</b> on the filter bar above to see them again.' })
          : emptyRow(13, { icon: '○', title: 'No journaled plans yet', body: 'Plans record automatically while the TPO scanners run during market hours.' }));
    }
    // A gate is a stat, not a tag: the one FAIL in a row of PASSes was rendering at
    // exactly the weight of the sample count. Same grammar as the scanner headers.
    const gateStat = (name, g) => ({
      k: `${name} · target ${g.target}`,
      v: `${fmt(g.value)} · ${g.pass === true ? 'PASS' : g.pass === false ? 'FAIL' : 'n<' + g.minN}`,
      cls: g.pass === true ? 'status-live' : g.pass === false ? 'status-delayed' : 'status-closed',
      tone: g.pass === true ? 'up' : g.pass === false ? 'down' : 'mut',
    });
    async function refresh() {
      let r; try { r = await api('/api/test/summary'); } catch (e) {
        $('#test-note').innerHTML = stateBlock({ kind: 'err', icon: '⚠', title: 'Could not load the journal', body: esc0(e.message) });
        return;
      }
      $('#test-note').innerHTML = '';
      $('#test-updated').textContent = 'updated ' + new Date(r.ts).toLocaleTimeString();
      const g = r.gates;
      const gates = $('#test-gates');
      gates.className = 'statstrip';
      statStrip(gates, [
        { k: 'closed trades', v: r.overall.trades, tone: g.sampleOk ? '' : 'mut' },
        gateStat('Profit Factor', g.pf), gateStat('Win Rate %', g.wr), gateStat('avg R:R', g.rr),
        g.sampleOk ? null
          : { k: 'sample', v: `insufficient — gates activate at n≥${g.minN}`, tone: 'mut wrap', cls: 'grow' },
      ]);
      const o = r.overall, d = $('#test-overall'); d.innerHTML = '';
      const tile = (k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); d.append(t); };
      tile('Profit Factor', o.profitFactor, o.profitFactor >= 1.5 ? 'good' : '');
      tile('Win Rate', o.winRate != null ? o.winRate + '%' : null, o.winRate >= 40 ? 'good' : '');
      tile('Expectancy', o.expectancyR != null ? o.expectancyR + 'R' : null, o.expectancyR > 0 ? 'good' : o.expectancyR < 0 ? 'bad' : '');
      tile('Total', o.totalR != null ? o.totalR + 'R' : null);
      tile('W / L / Scr', `${o.wins} / ${o.losses} / ${o.scratches}`);
      tile('Fill Rate', o.fillRate != null ? o.fillRate + '%' : null);
      tile('Missed (never filled)', o.missed);
      tile('Open plans', o.open);
      // Breakdown: three real tables. The first column now carries its own header
      // ("Market" / "Setup" / "Confidence") instead of the blank <th> the merged
      // version needed, so each table stands on its own.
      const bdRows = obj => Object.entries(obj).map(([k, st]) =>
        `<tr><td>${esc0(k)}</td><td class="num">${st.trades}</td><td class="num">${fmt(st.profitFactor)}</td><td class="num">${fmt(st.winRate)}</td><td class="num">${fmt(st.expectancyR)}</td><td class="num">${st.missed}</td></tr>`).join('');
      const bdTable = (sel, label, obj) => renderTable($(sel),
        `<tr><th>${label}</th><th class="num">n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th><th class="num">missed</th></tr>`
        + (Object.keys(obj || {}).length ? bdRows(obj)
          : emptyRow(6, { icon: '○', title: 'Nothing recorded yet', body: 'Plans record automatically while the TPO scanners run during market hours.' })));
      bdTable('#test-bd-market', 'Market', r.byMarket);
      bdTable('#test-bd-setup', 'Setup', r.bySetup);
      bdTable('#test-bd-conf', 'Confidence', r.byConfidence);
      // recent journal (filtered client-side; gates/summary/breakdown above are untouched)
      lastRecent = r.recent || [];
      paintRecent();
      $('#test-note').textContent = 'Only plans whose state reached VALID (a fillable entry) count toward PF / win-rate; the rest are “missed”. No mock data — everything above is recorded from live scans.';
    }
    async function backtest(btn) {
      btn.disabled = true; btn.textContent = 'Backtesting… (1-min candles)';
      const box = $('#test-bt'); box.classList.remove('hidden');
      box.innerHTML = '<h3>Running India 1-minute backtest…</h3><div class="prow">Replaying the most recent plans, one NSE-provider request each, paced to stay under the rate limit.</div>';
      let r; try { r = await api('/api/test/backtest', { method: 'POST' }); } catch (e) { r = { ok: false, error: e.message }; }
      btn.disabled = false; btn.textContent = 'Run India 1-min backtest';
      if (!r.ok) { box.innerHTML = `<h3>Backtest unavailable</h3><div class="prow">${r.error}</div>`; return; }
      const s = r.summary, g = r.gates;
      box.innerHTML = `<h3>India backtest — ${r.tested} plans @ ${r.resolution}${r.skipped ? ` · ${r.skipped} skipped` : ''}</h3>`
        + (r.note ? `<div class="prow">${r.note}</div>` : '')
        + `<div class="prow">PF <b>${fmt(s.profitFactor)}</b> · WR <b>${fmt(s.winRate)}%</b> · expectancy <b>${fmt(s.expectancyR)}R</b> · total <b>${fmt(s.totalR)}R</b> · fill rate <b>${fmt(s.fillRate)}%</b></div>`
        + `<div class="prow">Gates: PF ${g.pf.pass === true ? '✅' : g.pf.pass === false ? '❌' : '·'} · WR ${g.wr.pass === true ? '✅' : g.wr.pass === false ? '❌' : '·'} · R:R ${g.rr.pass === true ? '✅' : g.rr.pass === false ? '❌' : '·'} ${g.sampleOk ? '' : `(need n≥${g.minN})`}</div>`
        + (r.errors?.length ? `<div class="prow">Skipped: ${r.errors.join(' · ')}</div>` : '');
      refresh();   // journal rows now carry precise backtest outcomes
    }
    let wired = false;
    return {
      start() {
        if (!wired) {
          wired = true;
          filterBar = makeFilterBar('test', [
            { key: 'market', label: 'Market', type: 'select', test: F.eq('market'),
              options: [{ v: 'all', label: 'All' }, { v: 'india', label: 'India' }, { v: 'usa', label: 'USA' }] },
            { key: 'setup', label: 'Setup', type: 'select', test: F.eq('setup'),
              options: [{ v: 'all', label: 'All' }, { v: 'OPEN-DRIVE', label: 'Open-Drive' }, { v: 'IB-COIL', label: 'IB-Coil' }, { v: 'VALUE-EDGE', label: 'Value-Edge' }, { v: 'EXPANSION', label: 'Expansion' }] },
            { key: 'outcome', label: 'Outcome', type: 'select',
              test: (row, val) => val === 'all' ? true
                : val === 'open' ? (!row.outcome && row.status !== 'MISSED')
                : val === 'missed' ? row.status === 'MISSED'
                : row.outcome === val,
              options: [{ v: 'all', label: 'All' }, { v: 'WIN', label: 'Win' }, { v: 'LOSS', label: 'Loss' }, { v: 'SCRATCH', label: 'Scratch' }, { v: 'open', label: 'Open' }, { v: 'missed', label: 'Missed' }] },
            { key: 'sym', label: 'Symbol', type: 'text', placeholder: 'contains…', test: F.has('symbol') },
          ], paintRecent);
          $('#test-filters').append(filterBar.el);
          sorter = makeSortable('test', $('#test-table'), [
            { key: 'date', type: 'text' }, { key: 'market', type: 'text' }, { key: 'symbol', type: 'text' },
            { key: 'setup', type: 'text' }, { order: ORD.signal, key: 'signal' },
            { key: 'entry' }, { key: 'sl' }, { val: T1 }, { key: 'rr' }, { key: 'entryQuality' },
            { key: 'status', type: 'text' }, { order: ORD.outcome, key: 'outcome' }, { key: 'rMultiple' },
          ], paintRecent);
          $('#test-refresh').addEventListener('click', refresh);
          $('#test-backtest').addEventListener('click', e => backtest(e.target));
        }
        refresh();
      },
      stop() {},
    };
  }

  // ---------- Analytics tab (Monte Carlo · HMM · robustness) ----------
  function makeAnalytics() {
    const fmt = x => x == null ? '—' : x;
    const tile = (parent, k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); parent.append(t); };
    const setChart = (host, svg) => { host.innerHTML = svg; host.classList.toggle('hidden', !svg); };
    function mcSvg(mc) {
      if (!mc.ok) return '';
      const W = 720, H = 220, P = 30;
      const all = [...mc.bands.p5, ...mc.bands.p95];
      const lo = Math.min(0, ...all), hi = Math.max(1, ...all);
      const X = i => P + (W - 2 * P) * i / (mc.steps - 1);
      const Y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo || 1);
      const line = b => b.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      const area = (top, bot) => line(top) + bot.map((v, i) => `L${X(bot.length - 1 - i).toFixed(1)},${Y(bot[bot.length - 1 - i]).toFixed(1)}`).join('') + 'Z';
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px">
        <line x1="${P}" y1="${Y(0)}" x2="${W - P}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="4 4"/>
        <path d="${area(mc.bands.p95, mc.bands.p5)}" fill="color-mix(in srgb, var(--acc) 12%, transparent)" stroke="none"/>
        <path d="${area(mc.bands.p75, mc.bands.p25)}" fill="color-mix(in srgb, var(--acc) 22%, transparent)" stroke="none"/>
        <path d="${line(mc.bands.p50)}" fill="none" stroke="var(--acc)" stroke-width="2"/>
        <text x="${P}" y="14" fill="var(--mut)" font-size="11">Bootstrapped equity (R) — ${mc.runs} runs × ${mc.steps} trades · bands p5–p95 / p25–p75 / median</text>
        <text x="${P}" y="${Y(0) - 4}" fill="var(--mut)" font-size="10">0R</text>
      </svg>`;
    }
    function sparkline(vals) {
      const v = vals.filter(x => x != null);
      if (v.length < 2) return '';
      const W = 720, H = 90, P = 8;
      const lo = Math.min(1, ...v), hi = Math.max(2, ...v);
      const X = i => P + (W - 2 * P) * i / (v.length - 1);
      const Y = x => H - P - (H - 2 * P) * (x - lo) / (hi - lo || 1);
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px">
        <line x1="${P}" y1="${Y(1.5)}" x2="${W - P}" y2="${Y(1.5)}" stroke="var(--grn-line)" stroke-dasharray="3 4"/>
        <path d="${v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join('')}" fill="none" stroke="var(--grn)" stroke-width="2"/>
        <text x="${P}" y="12" fill="var(--mut)" font-size="11">Rolling Profit Factor (20-trade window) — dashed line = 1.5 gate</text>
      </svg>`;
    }
    async function refresh() {
      const risk = $('#ana-risk').value;
      $('#ana-updated').textContent = 'computing…';
      let r; try { r = await api('/api/analytics?riskPct=' + risk); } catch (e) {
        $('#ana-note').innerHTML = stateBlock({ kind: 'err', icon: '⚠', title: 'Could not compute analytics', body: esc0(e.message) });
        return;
      }
      $('#ana-note').innerHTML = '';
      $('#ana-updated').textContent = 'updated ' + new Date(r.ts).toLocaleTimeString();
      // Monte Carlo
      const mt = $('#ana-mc-tiles'); mt.innerHTML = '';
      const mc = r.monteCarlo;
      if (mc.ok) {
        tile(mt, 'Median final', mc.finalR.p50 + 'R', mc.finalR.p50 > 0 ? 'good' : 'bad');
        tile(mt, 'Worst 5%', mc.finalR.p5 + 'R', mc.finalR.p5 >= 0 ? 'good' : 'warn');
        tile(mt, 'P(profit)', mc.probProfit + '%', mc.probProfit >= 70 ? 'good' : '');
        tile(mt, 'Max DD (median)', mc.maxDD_R.p50 + 'R');
        tile(mt, 'Max DD (p95)', mc.maxDD_R.p95 + 'R', 'warn');
        tile(mt, `Risk of ruin @ ${mc.riskPct}%/trade`, mc.riskOfRuinPct + '%', mc.riskOfRuinPct > 5 ? 'bad' : 'good');
        setChart($('#ana-mc-chart'), mcSvg(mc));
      } else {
        mt.innerHTML = stateBlock({ kind: 'warn', icon: '◔', title: 'Not enough closed trades yet',
          body: `Monte Carlo needs <b>${mc.need}</b> closed trades and the journal has <b>${mc.n}</b>. Outcomes accrue as scanner plans fill and resolve — nothing here is simulated.` });
        setChart($('#ana-mc-chart'), '');
      }
      // HMM
      const ht = $('#ana-hmm-tiles'); ht.innerHTML = '';
      const hm = r.regime, htab = $('#ana-hmm-table');
      if (hm.ok) {
        tile(ht, 'Current regime', hm.current.label, /Uptrend/.test(hm.current.label) ? 'good' : /volatility|Downtrend/.test(hm.current.label) ? 'bad' : 'warn');
        tile(ht, 'Source', hm.source);
        renderTable(htab, `<tr><th>Regime</th><th class="num">μ daily%</th><th class="num">σ daily%</th><th class="num">stickiness</th><th class="num">your n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th></tr>`
          + hm.states.map(s => {
            const p = hm.perRegime[s.label] || {};
            return `<tr${s.state === hm.current.state ? ' class="is-current"' : ''}><td>${s.label}</td><td class="num">${s.meanDailyPct}</td><td class="num">${s.sdDailyPct}</td><td class="num">${s.stickiness}</td><td class="num">${fmt(p.n)}</td><td class="num">${fmt(p.pf)}</td><td class="num">${fmt(p.wr)}</td><td class="num">${fmt(p.expR)}</td></tr>`;
          }).join(''));
      } else {
        ht.innerHTML = stateBlock({ kind: 'warn', icon: '◔', title: 'Market regime unavailable',
          body: esc0(hm.error) });
        renderTable(htab, '');
      }
      // Robustness
      const rt = $('#ana-rob-tiles'); rt.innerHTML = '';
      const rb = r.robustness, rtab = $('#ana-rob-table');
      if (rb.ok) {
        tile(rt, 'Expectancy', `${rb.expectancyR}R ± ${rb.stderrR}`, rb.expectancy95[0] > 0 ? 'good' : rb.expectancy95[1] < 0 ? 'bad' : 'warn');
        tile(rt, '95% CI', `${rb.expectancy95[0]}R … ${rb.expectancy95[1]}R`);
        tile(rt, 'SQN', rb.sqn, rb.sqn >= 2 ? 'good' : rb.sqn < 1 ? 'warn' : '');
        renderTable(rtab, `<tr><th>Threshold sensitivity</th><th class="num">n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th></tr>`
          + rb.sensitivity.map(s => `<tr><td>${s.cut}</td><td class="num">${s.n}</td><td class="num">${fmt(s.pf)}</td><td class="num">${fmt(s.wr)}</td><td class="num">${fmt(s.expR)}</td></tr>`).join(''));
        setChart($('#ana-rob-chart'), sparkline(rb.rollingPF || []));
      } else {
        rt.innerHTML = stateBlock({ kind: 'warn', icon: '◔', title: 'Not enough closed trades yet',
          body: `Robustness needs <b>${rb.need}</b> closed trades and the journal has <b>${rb.n}</b>.` });
        renderTable(rtab, ''); setChart($('#ana-rob-chart'), '');
      }
      $('#ana-note').textContent = 'All analytics derive from the Testing journal’s real outcomes (and real NIFTY history for the regime model). A robust edge: expectancy CI above 0, SQN ≥ 2, PF stable across thresholds and regimes.';
    }
    let wired = false;
    return {
      start() {
        if (!wired) { wired = true; $('#ana-refresh').addEventListener('click', refresh); $('#ana-risk').addEventListener('change', refresh); }
        refresh();
      },
      stop() {},
    };
  }

  // ---------- Pattern Analysis (multi-timeframe confluence report) ----------
  // On-demand only: one request per Analyze click, no polling. Prefills (and auto-runs
  // once) from the active TradingView chart symbol, but stays editable for any symbol.
  // Symbol combobox shared by the analysis tabs. `prefix` keys the element ids
  // (pat-symbol/pat-suggest, vcp-symbol/vcp-suggest); `onPick` runs the tab's analysis.
  // Debounced lookup against /api/symbols, which is already filtered server-side to the
  // exchanges we can fetch history for. Keyboard-driven: up/down move, Enter picks the
  // highlighted row (or runs the analysis when the list is closed), Esc closes.
  function makeCombo(prefix, onPick) {
    const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const input = () => document.getElementById(prefix + '-symbol');
    const box = () => document.getElementById(prefix + '-suggest');
    let sug = [], active = -1, debounce = null, lastQ = '';

    function close() {
      sug = []; active = -1;
      box().classList.add('hidden');
      input().setAttribute('aria-expanded', 'false');
      input().removeAttribute('aria-activedescendant');
    }
    function paint() {
      box().innerHTML = sug.length
        ? sug.map((r, i) => `<li role="option" id="${prefix}-opt-${i}" data-i="${i}" class="${i === active ? 'active' : ''}"
            aria-selected="${i === active}"><span class="s-sym">${esc(r.symbol)}</span>
            <span class="s-ex">${esc(r.exchange)}</span>
            <span class="s-desc">${esc(r.description)}</span></li>`).join('')
        : `<li class="s-none">No matching NSE / NASDAQ / NYSE / AMEX symbol.</li>`;
      box().classList.remove('hidden');
      input().setAttribute('aria-expanded', 'true');
      // Without this the keyboard highlight moves silently — the input keeps focus,
      // so only activedescendant tells an AT which option is current.
      if (active >= 0) input().setAttribute('aria-activedescendant', prefix + '-opt-' + active);
      else input().removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      const r = sug[i];
      if (!r) return;
      input().value = r.value; close(); onPick();
    }
    async function lookup() {
      const q = input().value.trim();
      if (q.length < 1) return close();
      lastQ = q;
      let r;
      try { r = await api('/api/symbols?q=' + encodeURIComponent(q)); } catch { return; }
      if (lastQ !== input().value.trim()) return;      // a newer keystroke won
      sug = r?.rows || []; active = sug.length ? 0 : -1;
      paint();
    }
    function onKey(e) {
      const open = !box().classList.contains('hidden') && sug.length;
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); active = (active + 1) % sug.length; paint(); }
      else if (e.key === 'ArrowUp' && open) { e.preventDefault(); active = (active - 1 + sug.length) % sug.length; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); open && active >= 0 ? pick(active) : (close(), onPick()); }
      else if (e.key === 'Escape') close();
    }
    return {
      close, esc,
      wire() {
        input().addEventListener('keydown', onKey);
        input().addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(lookup, 180); });
        input().addEventListener('blur', () => setTimeout(close, 150));
        box().addEventListener('mousedown', e => {
          const li = e.target.closest('li[data-i]');
          if (li) { e.preventDefault(); pick(+li.dataset.i); }
        });
      },
    };
  }

  function makePatterns() {
    const combo = makeCombo('pat', () => run());
    const esc = combo.esc;
    const fmt = x => x == null ? '—' : x;
    const num = x => x == null ? '—' : (x > 0 ? '+' : '') + x;
    const biasCls = b => /Strong Bullish|Bullish/.test(b) ? 'good' : /Bearish/.test(b) ? 'bad' : 'warn';
    const statusCls = s => s === 'Confirmed' ? 'good' : s === 'Failed' ? 'bad' : 'warn';
    let busy = false;

    async function run() {
      const sym = $('#pat-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#pat-body').classList.add('hidden');
      $('#pat-empty').classList.remove('hidden');
      $('#pat-empty').innerHTML = stateBlock({ icon: '◍', title: `Analysing ${esc0(sym)}…`, body: 'Fetching 4H / Daily / Weekly / Monthly history.' });
      $('#pat-note').textContent = '';
      let r;
      try { r = await api('/api/patterns?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#pat-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#pat-body').classList.add('hidden');
        $('#pat-empty').classList.remove('hidden');
        $('#pat-empty').innerHTML = stateBlock({ kind: 'err', icon: '⚠',
          title: `Could not analyse ${esc0(sym)}`, body: esc0(r?.error || 'request failed') });
        announce(`Could not analyse ${sym}. ${r?.error || 'request failed'}`);
        $('#pat-src').textContent = '—'; $('#pat-note').textContent = '';
        return;
      }
      $('#pat-empty').classList.add('hidden');
      $('#pat-body').classList.remove('hidden');
      announce(`Analysis ready for ${sym}.`);
      $('#pat-src').textContent = (r.market === 'india' ? '🇮🇳 NSE' : '🇺🇸 US') + ' · real OHLC';
      $('#pat-note').textContent = 'Source: ' + r.source;

      // Overall assessment
      const d = $('#pat-overall'); d.innerHTML = '';
      const tile = (k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); d.append(t); };
      tile('Symbol', r.symbol);
      tile('Price', r.price);
      tile('Overall bias', r.overall.bias, biasCls(r.overall.bias));
      tile('Composite', num(r.overall.composite), biasCls(r.overall.bias));
      tile('Confidence', r.overall.confidence + '%', r.overall.confidence >= 60 ? 'good' : r.overall.confidence >= 30 ? 'warn' : '');
      tile('TF alignment', r.overall.aligned ? 'aligned' : 'conflicting', r.overall.aligned ? 'good' : 'warn');
      tile('Daily ATR', r.dayATR);
      tile('Patterns', r.patterns.length);
      const miss = $('#pat-missing');
      if (r.overall.timeframesMissing.length) {
        miss.className = 'statstrip';
        statStrip(miss, [{ k: 'timeframes unavailable', v: r.overall.timeframesMissing.join(' · '),
          cls: 'status-delayed wide', tone: 'mut wrap' }]);
      } else { miss.className = 'metaline'; miss.innerHTML = ''; }

      // Timeframe analysis
      renderTable($('#pat-tf'), `<tr><th>Timeframe</th><th class="num">Close</th><th class="num">Δ 20 bars</th>
        <th>Stage</th><th>Structure</th><th class="num">30-MA</th><th class="num">50-MA</th><th class="num">200-MA</th>
        <th class="num">ATR%</th><th class="num">rVol</th><th class="num">Bias</th><th class="num">Patterns</th></tr>`
        + r.timeframes.map(t => t.ok
          ? `<tr><td><b>${esc(t.label)}</b> <small>${t.bars} bars</small></td><td class="num">${fmt(t.close)}</td>
             <td class="num">${num(t.changePct)}%</td><td>${esc(t.stage.label)}</td><td>${esc(t.structure.label)}</td>
             <td class="num">${fmt(t.stage.ma)}</td><td class="num">${fmt(t.ma50)}</td><td class="num">${fmt(t.ma200)}</td>
             <td class="num">${fmt(t.atrPct)}</td><td class="num">${fmt(t.rvol)}</td>
             <td class="num">${num(t.dir)}</td><td class="num">${t.patterns.length}</td></tr>`
          : `<tr><td><b>${esc(t.label)}</b></td><td colspan="11" class="hint">unavailable — ${esc(t.error)}</td></tr>`).join(''));

      // Stage analysis
      renderTable($('#pat-stages'), `<tr><th>Timeframe</th><th>Stage</th><th>Phase</th><th class="num">Stage MA</th>
        <th class="num">MA slope %/5 bars</th><th class="num">Dist (ATR)</th><th class="num">Confidence</th><th>Read</th></tr>`
        + r.stages.map(s => `<tr><td>${esc(s.tf)}</td><td><b>${esc(s.label)}</b></td><td>${esc(s.phase)}</td>
            <td class="num">${fmt(s.ma)}</td><td class="num">${num(s.maSlopePct)}</td><td class="num">${num(s.distATR)}</td>
            <td class="num">${s.confidence}%</td><td>${esc(s.reason)}</td></tr>`).join(''));

      // Pattern summary
      renderTable($('#pat-patterns'), `<tr><th>Timeframe</th><th>Pattern</th><th>Bias</th><th>Status</th>
        <th class="num">Confidence</th><th class="num">Score</th><th>HTF aligned</th><th class="num">Target</th><th>Evidence</th></tr>`
        + (r.patterns.length
          ? r.patterns.map(p => `<tr><td>${esc(p.timeframe)}</td><td><b>${esc(p.pattern)}</b></td>
              <td class="${biasCls(p.bias)}">${esc(p.bias)}</td><td class="${statusCls(p.status)}"><b>${esc(p.status)}</b></td>
              <td class="num">${p.confidence}%</td><td class="num"><b>${p.score}</b>/10</td>
              <td class="${p.htfAligned === 'yes' ? 'good' : p.htfAligned === 'no' ? 'bad' : ''}">${esc(p.htfAligned)}</td>
              <td class="num">${fmt(p.levels?.target)}</td><td>${esc(p.detail)}</td></tr>`).join('')
          : `<tr><td colspan="9" class="hint">No pattern clears the 55% high-confidence bar on any timeframe — stand aside.</td></tr>`));

      // Key levels
      const lvl = (rows, kind) => rows.map(x => `<tr><td>${kind}</td><td class="num"><b>${x.price}</b></td>
        <td class="num">${num(x.distPct)}%</td><td class="num">${x.strength}</td><td class="num">${x.touches}</td>
        <td>${x.sources.map(esc).join(' · ')}</td></tr>`).join('');
      renderTable($('#pat-levels'), `<tr><th>Type</th><th class="num">Level</th><th class="num">Distance</th>
        <th class="num">Strength</th><th class="num">Confluence</th><th>Built from</th></tr>`
        + lvl(r.levels.resistance.slice().reverse(), 'Resistance') + lvl(r.levels.support, 'Support'));

      // Conclusion
      $('#pat-conclusion').innerHTML = r.conclusion.map(c => `<li>${esc(c)}</li>`).join('');
    }

    let wired = false;
    return {
      start() {
        if (!wired) {
          wired = true;
          combo.wire();
          $('#pat-run').addEventListener('click', () => { combo.close(); run(); });
        }
        // Deliberately no auto-detect and no auto-run: analysis happens only when you
        // ask for it. The box carries the symbol you last analysed so you can switch
        // methodology on one name, but you still press Analyze.
        if (SELECTED_SYMBOL && !$('#pat-symbol').value) $('#pat-symbol').value = SELECTED_SYMBOL;
      },
      stop() {},
    };
  }

  // ---------- Minervini VCP ----------
  // Verdict-first: the two-second read is the verdict tile row, then the Trend Template
  // checklist (the gate), the contraction footprint, and the trade plan.
  function makeVCP() {
    const combo = makeCombo('vcp', () => run());
    const esc = combo.esc;
    const fmt = x => x == null ? '\u2014' : x;
    const num = x => x == null ? '\u2014' : (x > 0 ? '+' : '') + x;
    const vCls = v => v === 'BUY-READY' ? 'good' : v === 'SETUP FORMING' ? 'warn'
      : v === 'EXTENDED' ? 'warn' : v === 'WATCH' ? '' : 'bad';
    let busy = false;

    async function run() {
      const sym = $('#vcp-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#vcp-body').classList.add('hidden');
      $('#vcp-empty').classList.remove('hidden');
      $('#vcp-empty').innerHTML = stateBlock({ icon: '◍', title: `Analysing ${esc0(sym)}…`, body: 'Fetching history and ranking it against its market.' });
      $('#vcp-note').textContent = '';
      let r;
      try { r = await api('/api/vcp?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#vcp-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#vcp-body').classList.add('hidden');
        $('#vcp-empty').classList.remove('hidden');
        $('#vcp-empty').innerHTML = stateBlock({ kind: 'err', icon: '⚠',
          title: `Could not analyse ${esc0(sym)}`, body: esc0(r?.error || 'request failed') });
        announce(`Could not analyse ${sym}. ${r?.error || 'request failed'}`);
        $('#vcp-src').textContent = '\u2014'; $('#vcp-note').textContent = '';
        return;
      }
      $('#vcp-empty').classList.add('hidden');
      $('#vcp-body').classList.remove('hidden');
      announce(`Analysis ready for ${sym}.`);
      $('#vcp-src').textContent = (r.market === 'india' ? '\ud83c\uddee\ud83c\uddf3 NSE' : '\ud83c\uddfa\ud83c\uddf8 US') + ' \u00b7 real OHLC';
      $('#vcp-note').textContent = 'Source: ' + r.source;

      // Verdict tiles
      const d = $('#vcp-verdict'); d.innerHTML = '';
      const tile = (k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); d.append(t); };
      const tt = r.trendTemplate, v = r.vcp;
      tile('Symbol', r.symbol);
      tile('Price', r.price);
      tile('Verdict', r.verdict.label, vCls(r.verdict.label));
      tile('Trend Template', `${tt.passed}/8`, tt.passed === 8 ? 'good' : tt.passed >= 7 ? 'warn' : 'bad');
      tile('RS Rating', r.rs.ok ? r.rs.rs : 'n/a', r.rs.ok ? (r.rs.rs >= 80 ? 'good' : r.rs.rs >= 70 ? 'warn' : 'bad') : 'warn');
      tile('Contractions', v.ok ? v.count : '\u2014', v.ok ? 'good' : '');
      tile('Pivot', v.ok ? v.pivot : '\u2014');
      tile('Score', r.verdict.score + '/10', r.verdict.score >= 7 ? 'good' : r.verdict.score >= 5 ? 'warn' : 'bad');
      tile('Confidence', r.verdict.confidence + '%', r.verdict.confidence >= 70 ? 'good' : r.verdict.confidence >= 40 ? 'warn' : '');
      const why = $('#vcp-why'); why.className = 'statstrip';
      statStrip(why, [{
        k: 'why this verdict', v: r.verdict.why, cls: 'wide',
        tone: (r.verdict.label === 'BUY-READY' ? 'up' : 'mut') + ' wrap',
      }]);

      // Trend Template checklist
      renderTable($('#vcp-tt'), `<tr><th>#</th><th>Criterion</th><th>Result</th><th>Measured</th></tr>`
        + tt.criteria.map(c => `<tr><td>${c.id}</td><td>${esc(c.label)}</td>
            <td class="${c.pass ? 'good' : 'bad'}"><b>${c.pass ? '\u2713 pass' : '\u2717 fail'}</b></td>
            <td>${esc(c.actual)}</td></tr>`).join(''));

      // Contractions
      if (v.ok) {
        renderTable($('#vcp-contractions'), `<tr><th>#</th><th class="num">High</th><th class="num">Low</th>
          <th class="num">Depth</th><th class="num">vs prior</th><th class="num">Sessions</th><th class="num">Volume vs 50d</th></tr>`
          + v.contractions.map(c => `<tr><td>${c.n}</td><td class="num">${c.high}</td><td class="num">${c.low}</td>
              <td class="num"><b>${c.depthPct}%</b></td><td class="num">${c.vsPrior == null ? '\u2014' : c.vsPrior + '\u00d7'}</td>
              <td class="num">${c.bars}</td><td class="num">${fmt(c.volVs50d)}\u00d7</td></tr>`).join(''));
        const base = $('#vcp-base'); base.className = 'statstrip';
        // Volume drying up into the last contraction is the actual VCP signal, so it
        // is the one cell here that earns a colour.
        const dry = v.dryUpVs50d != null && v.dryUpVs50d < 0.8;
        statStrip(base, [
          { k: 'footprint', v: v.footprint },
          { k: 'base', v: `${v.baseDepthPct}% deep / ${v.baseBars} sessions` },
          { k: 'volume dry-up', v: `${fmt(v.dryUpVs50d)}\u00d7 the 50-day avg`, tone: dry ? 'up' : 'mut', cls: dry ? 'status-live' : '' },
          { k: 'tightness', v: v.tightnessPct + '%' },
          { k: 'pivot', v: `${v.pivot} (${num(v.distToPivotPct)}% away)`, cls: 'grow' },
        ]);
      } else {
        renderTable($('#vcp-contractions'), `<tr><td class="hint">${esc(v.error)}</td></tr>`);
        $('#vcp-base').className = 'metaline'; $('#vcp-base').innerHTML = '';
      }

      // Trade plan
      const pd = $('#vcp-plan'); pd.innerHTML = '';
      const ptile = (k, val, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(val)))); pd.append(t); };
      if (r.tradePlan) {
        const p = r.tradePlan;
        ptile('Buy above', p.pivot, 'good');
        ptile('Low cheat entry', p.cheatEntry ?? 'n/a (base not tight enough)');
        ptile('Stop', p.stop, 'bad');
        ptile('Risk', `\u2212${p.stopPct}%`, p.stopPct <= 7 ? 'good' : 'warn');
        ptile('Target 2R', p.targets[0]);
        ptile('Target 3R', p.targets[1]);
        ptile('Stop basis', p.stopBasis);
        ptile('Trigger', p.trigger);
        $('#vcp-sizing').innerHTML = `<span class="tag">${esc(p.sizing)}</span>`;
      } else {
        pd.innerHTML = '<div class="hint">No trade plan \u2014 there is no valid base to buy.</div>';
        $('#vcp-sizing').innerHTML = '';
      }

      // Context
      const ctx = r.context;
      renderTable($('#vcp-context'), `<tr><th>Item</th><th>Value</th><th>Detail</th></tr>`
        + `<tr><td>Weekly stage</td><td><b>${esc(ctx.weeklyStage?.label || 'n/a')}</b></td><td>${ctx.weeklyStage ? ctx.weeklyStage.confidence + '% confidence, 30-week MA ' + ctx.weeklyStage.ma : 'weekly history unavailable'}</td></tr>`
        + `<tr><td>Daily stage</td><td><b>${esc(ctx.dailyStage.label)}</b></td><td>${ctx.dailyStage.confidence}% confidence, 30-day MA ${ctx.dailyStage.ma}</td></tr>`
        + `<tr><td>RS Rating</td><td><b>${r.rs.ok ? r.rs.rs : 'n/a'}</b></td><td>${r.rs.ok ? `3M ${r2s(r.rs.p3)}% \u00b7 6M ${r2s(r.rs.p6)}% \u00b7 1Y ${r2s(r.rs.p12)}% \u00b7 ranked against ${r.rs.universe} names` : esc(r.rs.error || '')}</td></tr>`
        + `<tr><td>RS method</td><td>percentile</td><td>${esc(r.rs.method || '')}${r.rs.filter ? ' \u2014 universe: ' + esc(r.rs.filter) : ''}</td></tr>`
        + `<tr><td>52-week range</td><td>${tt.low52} \u2013 ${tt.high52}</td><td>+${tt.aboveLowPct}% above the low, \u2212${tt.belowHighPct}% from the high</td></tr>`
        + `<tr><td>Moving averages</td><td>50 / 150 / 200</td><td>${tt.ma50} / ${tt.ma150} / ${tt.ma200} \u00b7 200-MA slope ${num(tt.ma200SlopePct)}% over 22 sessions</td></tr>`);

      $('#vcp-conclusion').innerHTML = r.conclusion.map(c => `<li>${esc(c)}</li>`).join('');
    }
    const r2s = x => x == null ? '\u2014' : Math.round(x * 10) / 10;

    let wired = false;
    return {
      start() {
        if (!wired) {
          wired = true;
          combo.wire();
          $('#vcp-run').addEventListener('click', () => { combo.close(); run(); });
        }
        // Deliberately no auto-detect and no auto-run: analysis happens only when you
        // ask for it. The box carries the symbol you last analysed so you can switch
        // methodology on one name, but you still press Analyze.
        if (SELECTED_SYMBOL && !$('#vcp-symbol').value) $('#vcp-symbol').value = SELECTED_SYMBOL;
      },
      stop() {},
    };
  }

  // ---------- Elliott Wave ----------
  // Primary count first, then the alternates that remain rule-valid. The invalidation
  // level is given its own line because it is the only number here that is objective.
  function makeElliott() {
    const combo = makeCombo('ew', () => run());
    const esc = combo.esc;
    const fmt = x => x == null ? '\u2014' : x;
    const num = x => x == null ? '\u2014' : (x > 0 ? '+' : '') + x;
    const cCls = c => c >= 65 ? 'good' : c >= 45 ? 'warn' : '';
    const yn = v => v == null ? '<span class="warn">n/a</span>' : v ? '<span class="good">\u2713</span>' : '<span class="bad">\u2717</span>';
    let busy = false;

    async function run() {
      const sym = $('#ew-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#ew-body').classList.add('hidden');
      $('#ew-empty').classList.remove('hidden');
      $('#ew-empty').innerHTML = stateBlock({ icon: '◍', title: `Analysing ${esc0(sym)}…`, body: 'Counting waves across four degrees.' });
      $('#ew-note').textContent = '';
      let r;
      try { r = await api('/api/elliott?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#ew-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#ew-body').classList.add('hidden');
        $('#ew-empty').classList.remove('hidden');
        $('#ew-empty').innerHTML = stateBlock({ kind: 'err', icon: '⚠',
          title: `Could not analyse ${esc0(sym)}`, body: esc0(r?.error || 'request failed') });
        announce(`Could not analyse ${sym}. ${r?.error || 'request failed'}`);
        $('#ew-src').textContent = '\u2014'; $('#ew-note').textContent = '';
        return;
      }
      $('#ew-empty').classList.add('hidden');
      $('#ew-body').classList.remove('hidden');
      announce(`Analysis ready for ${sym}.`);
      $('#ew-src').textContent = (r.market === 'india' ? '\ud83c\uddee\ud83c\uddf3 NSE' : '\ud83c\uddfa\ud83c\uddf8 US') + ' \u00b7 real OHLC';
      $('#ew-note').textContent = 'Source: ' + r.source + ' \u00b7 Scope: ' + r.scope;

      const p = r.primary;
      const d = $('#ew-primary'); d.innerHTML = '';
      const tile = (k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); d.append(t); };
      tile('Symbol', r.symbol);
      tile('Price', r.price);
      if (!p) {
        tile('Count', 'none valid', 'warn');
        const inv0 = $('#ew-invalidation'); inv0.className = 'statstrip';
        statStrip(inv0, [{ k: 'count', v: 'none valid', cls: 'status-delayed' },
          { k: '', v: 'No rule-valid impulse or simple correction on any timeframe \u2014 an honest "no count", not a failure.', tone: 'mut wrap', cls: 'grow' }]);
        ['ew-waves', 'ew-rules', 'ew-projections', 'ew-alternates', 'ew-personality'].forEach(id => { document.getElementById(id).innerHTML = ''; });
        renderTable($('#ew-nesting'), '');
        $('#ew-conclusion').innerHTML = r.conclusion.map(c => `<li>${esc(c)}</li>`).join('');
        return;
      }
      tile('Timeframe', `${p.timeframe} (${p.degree})`);
      tile('Structure', p.structure, p.structure === 'Impulse' ? 'good' : '');
      tile('Position', p.position);
      tile('State', p.inProgress ? 'in progress' : 'complete', p.inProgress ? 'warn' : 'good');
      tile('Confidence', p.confidence + '%', cCls(p.confidence));
      tile('Hard rules', p.ruleCompliance, p.ruleCompliance.split('/')[0] === p.ruleCompliance.split('/')[1] ? 'good' : 'bad');
      tile('Guideline score', p.guidelineScore + '/10', p.guidelineScore >= 7 ? 'good' : p.guidelineScore >= 5 ? 'warn' : '');
      tile('Chart explained', p.coverage + '%');
      tile('Swing threshold', p.swingThreshold);
      // The invalidation price is the only objective number on this tab, so it leads
      // the strip; the rule and the caveat follow as context, not as equals.
      const inv = $('#ew-invalidation'); inv.className = 'statstrip';
      statStrip(inv, [
        { k: 'invalidation', v: p.invalidation, tone: 'down' },
        { k: 'rule', v: p.invalidationRule, tone: 'mut wrap' },
        { k: '', v: 'beyond this price the count is dead and must be re-labelled', tone: 'mut wrap', cls: 'grow' },
      ]);

      renderTable($('#ew-waves'), `<tr><th>Wave</th><th class="num">From</th><th class="num">To</th>
        <th class="num">Move</th><th class="num">Size (ATR)</th><th class="num">Bars</th><th>Fibonacci ratio</th></tr>`
        + p.waves.map(w => `<tr><td><b>${esc(w.label)}</b>${w.provisional ? ' <small>in progress</small>' : ''}</td>
            <td class="num">${w.from}</td><td class="num">${w.to}</td><td class="num">${num(w.movePct)}%</td>
            <td class="num">${w.atr}</td><td class="num">${w.bars}</td><td>${w.fib ? esc(w.fib) : '\u2014'}</td></tr>`).join(''));

      renderTable($('#ew-rules'), `<tr><th>Rule</th><th>Requirement</th><th>Result</th><th>Measured</th></tr>`
        + p.rules.map(x => `<tr><td>${x.id}</td><td>${esc(x.label)}</td>
            <td class="${x.pass ? 'good' : 'bad'}"><b>${x.pass ? '\u2713 holds' : '\u2717 broken'}</b></td>
            <td>${esc(x.detail)}</td></tr>`).join(''));

      renderTable($('#ew-projections'), p.projections.length
        ? `<tr><th>Target</th><th>Basis</th><th class="num">Price</th><th class="num">Distance</th></tr>`
          + p.projections.map(x => `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.basis)}</td>
              <td class="num">${x.price}</td><td class="num">${num(x.distPct)}%</td></tr>`).join('')
        : `<tr><td class="hint">No standard projection applies at this wave position.</td></tr>`);

      renderTable($('#ew-alternates'), r.alternates.length
        ? `<tr><th>Structure</th><th>Direction</th><th>Position</th><th>Degree</th><th class="num">Confidence</th>
           <th class="num">Guideline</th><th class="num">Invalidation</th><th>Why it differs</th></tr>`
          + r.alternates.map(a => `<tr><td><b>${esc(a.structure)}</b></td><td>${esc(a.direction)}</td>
              <td>${esc(a.position)}</td><td>${esc(a.degree)}</td>
              <td class="num ${cCls(a.confidence)}">${a.confidence}%</td><td class="num">${a.guidelineScore}/10</td>
              <td class="num">${a.invalidation}</td><td>${esc(a.from || 'alternate reading')}</td></tr>`).join('')
        : `<tr><td class="hint">No other rule-valid count \u2014 unusually unambiguous, but still only one interpretation.</td></tr>`);

      renderTable($('#ew-nesting'), `<tr><th>Timeframe</th><th>Degree</th><th>Structure</th><th>Position</th>
        <th>Direction</th><th class="num">Confidence</th><th class="num">Invalidation</th></tr>`
        + r.nesting.map(n => `<tr><td>${esc(n.tf)}</td><td>${esc(n.degree)}</td><td>${esc(n.structure)}</td>
            <td>${esc(n.position)}</td><td>${esc(n.direction)}</td>
            <td class="num ${cCls(n.confidence)}">${n.confidence}%</td><td class="num">${n.invalidation}</td></tr>`).join('')
        + `<tr><td colspan="7" class="${r.aligned ? 'good' : 'warn'}">${r.aligned
            ? 'All counted degrees agree on direction \u2014 nesting is consistent.'
            : 'Degrees disagree on direction \u2014 low conviction; defer to the higher degree.'}</td></tr>`);

      renderTable($('#ew-personality'), `<tr><th>Check</th><th>Result</th><th>Detail</th></tr>`
        + p.personality.map(x => `<tr><td>${esc(x.check)}</td><td>${yn(x.pass)}</td><td>${esc(x.detail)}</td></tr>`).join(''));

      $('#ew-conclusion').innerHTML = r.conclusion.map(c => `<li>${esc(c)}</li>`).join('');
    }

    let wired = false;
    return {
      start() {
        if (!wired) {
          wired = true;
          combo.wire();
          $('#ew-run').addEventListener('click', () => { combo.close(); run(); });
        }
        // Deliberately no auto-detect and no auto-run: analysis happens only when you
        // ask for it. The box carries the symbol you last analysed so you can switch
        // methodology on one name, but you still press Analyze.
        if (SELECTED_SYMBOL && !$('#ew-symbol').value) $('#ew-symbol').value = SELECTED_SYMBOL;
      },
      stop() {},
    };
  }

  // ---------- Breakout scanners (Breakout-Patterns + VCP/Elliott-Breakout) ----------
  // Both tabs are one implementation over /api/breakouts; `mode` only decides which
  // engine the server runs and which columns the table renders. On demand only: the
  // deep pass costs provider requests, so nothing here polls.
  // Client-side filters over the shortlist a scan already returned — narrowing costs
  // nothing (no second two-stage provider scan). Readiness is shared; the last control
  // differs by engine (Status for chart patterns, Verdict for the methodology engines).
  function brkFilterControls(mode) {
    // Pre-breakout lifecycle tier. The strict rejects already keep the set small and clean,
    // and rows are sorted best-tier-first, so the default shows all survivors (CONFIRMED →
    // PRE-BREAKOUT → WATCH) rather than hiding the only candidate. "Ready" is one click away.
    const tier = { key: 'tier', label: 'Tier', type: 'select',
      test: (row, val) => val === 'all' ? true
        : val === 'ready' ? (row.tier === 'CONFIRMED' || row.tier === 'PRE-BREAKOUT')
        : row.tier === val,
      options: [{ v: 'all', label: 'All tiers' }, { v: 'ready', label: 'Ready (pre + confirmed)' },
        { v: 'CONFIRMED', label: 'Confirmed breakout' }, { v: 'PRE-BREAKOUT', label: 'High-confidence pre-breakout' },
        { v: 'WATCH', label: 'Watch' }] };
    const readiness = { key: 'ready', label: 'Distance', type: 'select', test: F.eq('readiness'),
      options: [{ v: 'all', label: 'All' }, { v: 'AT PIVOT', label: 'At pivot' }, { v: 'NEAR', label: 'Near' }, { v: 'APPROACHING', label: 'Approaching' }] };
    const symbol = { key: 'sym', label: 'Symbol', type: 'text', placeholder: 'contains…', test: F.has('symbol') };
    const last = mode === 'patterns'
      ? { key: 'status', label: 'Status', type: 'select', test: F.eq('status'),
          options: [{ v: 'all', label: 'All' }, { v: 'Confirmed', label: 'Confirmed' }, { v: 'Developing', label: 'Developing' }] }
      : { key: 'verdict', label: 'Verdict', type: 'select',
          test: (row, val) => val === 'all' ? true : val === 'ready' ? row.verdict === 'BUY-READY' : row.verdict !== 'BUY-READY',
          options: [{ v: 'all', label: 'All' }, { v: 'ready', label: 'BUY-READY' }, { v: 'other', label: 'Forming' }] };
    return [tier, symbol, readiness, last];
  }

  function makeBreakouts(prefix, mode) {
    const id = s => document.getElementById(prefix + '-' + s);
    const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const fmt = x => x == null ? '—' : x;
    const num = x => x == null ? '—' : (x > 0 ? '+' : '') + x;
    const rCls = r => r === 'AT PIVOT' ? 'good' : r === 'NEAR' ? 'warn' : '';
    const cols = mode === 'patterns' ? 15 : 14;
    let busy = false, filterBar = null, sorter = null, lastRows = [], lastThresholds = null, lastCoverage = null;
    // Pre-breakout lifecycle tier badge (colour carries the market meaning).
    const tierCell = x => {
      const t = x.tier;
      const cls = t === 'CONFIRMED' ? 'tier-confirmed' : t === 'PRE-BREAKOUT' ? 'tier-pre' : 'tier-watch';
      const label = t === 'CONFIRMED' ? 'CONFIRMED' : t === 'PRE-BREAKOUT' ? 'PRE-BREAKOUT' : t === 'WATCH' ? 'WATCH' : '—';
      const title = x.readinessScore != null ? `breakout readiness ${x.readinessScore}/100` : '';
      return `<td><span class="tier ${cls}" title="${title}">${label}</span></td>`;
    };
    const whyCell = x => {
      const extra = x.qualifyReasons?.length ? x.qualifyReasons.join(' · ') : '';
      return `<td class="reason" title="${esc([x.detail, extra].filter(Boolean).join(' — ')).replace(/"/g, '&quot;')}">`
        + `<span class="clamp">${esc(x.detail)}</span>`
        + (extra ? `<span class="why clamp">${esc(extra)}</span>` : '') + `</td>`;
    };

    function query(path = '/api/breakouts') {
      const p = new URLSearchParams({ region: id('region').value, tf: id('tf').value });
      if (mode === 'patterns') p.set('pattern', id('pattern').value);
      else p.set('type', id('type').value);
      return path + '?' + p.toString();
    }

    async function run() {
      if (busy) return;
      busy = true;
      const meta = id('meta'), body = id('body');
      meta.className = 'metaline';
      meta.className = 'metaline';
      meta.textContent = 'Stage 1: screening the universe…';
      id('note').innerHTML = ''; id('skipped').innerHTML = '';
      body.innerHTML = skeletonRows(cols, 6);
      body.parentElement.classList.add('is-busy');
      lastRows = [];
      let r;
      try { r = await runStreaming(); } catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      body.parentElement.classList.remove('is-busy');
      if (r && r.__cancelled) {                     // user pressed Cancel — keep what arrived
        meta.className = 'metaline'; meta.innerHTML = '';
        id('updated').textContent = 'cancelled ' + new Date().toLocaleTimeString();
        id('note').innerHTML = stateBlock({ kind: 'warn', icon: '⚠', title: 'Scan cancelled',
          body: `Stopped after <b>${r.processed}</b> of <b>${r.total}</b> candidates. Symbols already fetched are cached, so pressing <b>Scan</b> again resumes from here rather than starting over.` });
        paintRows();
        return;
      }
      id('updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        meta.className = 'metaline';
        meta.innerHTML = '';
        id('body').innerHTML = emptyRow(cols, { kind: 'err', icon: '⚠', title: 'Scan failed', body: esc(r?.error || 'request failed') });
        announce('Scan failed. ' + (r?.error || 'request failed'));
        return;
      }

      // Same stat-strip grammar as the TPO scanners, so a trader reads both
      // tabs the same way instead of relearning a flat row of equal-weight tags.
      const st = r.dataStatus || 'unknown';
      const tc = r.tierCounts || {};
      const found = r.count;
      meta.className = 'statstrip';
      statStrip(meta, [
        { k: 'feed', v: st === 'live' ? 'LIVE' : st === 'delayed' ? 'DELAYED' : st === 'closed' ? 'MARKET CLOSED' : '—', cls: 'status-' + st, dot: true },
        { k: 'found', v: r.truncated ? `${found} (showing ${r.returned})` : found, tone: found ? 'up' : 'mut' },
        tc.CONFIRMED ? { k: 'confirmed', v: tc.CONFIRMED, tone: 'up' } : null,
        tc['PRE-BREAKOUT'] ? { k: 'pre-breakout', v: tc['PRE-BREAKOUT'] } : null,
        tc.WATCH ? { k: 'watch', v: tc.WATCH, tone: 'mut' } : null,
        { k: 'region', v: r.marketLabel, tone: 'mut' },
        { k: 'timeframe', v: r.timeframe, tone: 'mut' },
        mode === 'patterns' ? { k: 'pattern', v: r.patternType === 'all' ? 'all bullish' : r.patternType, tone: 'mut' } : null,
        { k: 'near highs', v: `${r.prefiltered} / ${r.universe}`, tone: 'mut' },
        { k: 'deep-analysed', v: `${r.analysed} / ${r.candidates}`, tone: 'mut' },
        r.cached ? { k: 'source', v: '10-min cache', tone: 'mut' } : null,
        { k: '', v: '', cls: 'grow' },
      ]);
      // Caveats that do not belong in a stat cell keep their own honest line.
      const caveats = [
        r.timeframe !== r.requestedTimeframe ? `${r.requestedTimeframe} is not applicable to this engine — showing ${r.timeframe}.` : '',
        r.stoppedEarly ? esc(r.stoppedEarly) : '',
      ].filter(Boolean);
      id('note').innerHTML = caveats.length
        ? stateBlock({ kind: 'warn', icon: '⚠', title: 'Partial result', body: caveats.join(' ') }) : '';

      announce(`Scan complete. ${r.count} candidates, ${r.analysed} of ${r.candidates} deep-analysed.`);
      lastRows = r.rows || [];
      lastThresholds = r.thresholds;
      lastCoverage = { analysed: r.analysed, candidates: r.candidates };
      paintRows();

      // The Stage-2 rejection list can run to a dozen repeated sentences; a
      // collapsed, capped region keeps it available without burying the table.
      id('skipped').innerHTML = r.skipped?.length
        ? `<details class="disclosure skiplist"><summary>${r.skipped.length} candidate(s) rejected in Stage 2</summary>`
          + `<div class="disclosure-body"><ul>${r.skipped.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></details>` : '';
      if (r.note) id('note').insertAdjacentHTML('beforeend', `<p class="hint">${esc(r.note)}</p>`);
    }

    // A full-shortlist pass is minutes of sequential provider calls. Server-Sent Events
    // report it as it happens — progress per candidate, rows as they qualify — instead of
    // leaving one pending request and a static message on screen. Falls back to the plain
    // JSON endpoint wherever EventSource is unavailable or the stream dies before it says
    // anything, so the tab never depends on streaming working.
    function runStreaming() {
      if (typeof EventSource === 'undefined') return api(query());
      return new Promise((resolve, reject) => {
        const es = new EventSource(query('/api/breakouts/stream'));
        let sawEvent = false, done = false, total = 0, processed = 0, analysed = 0, lastPaint = 0;
        const finish = (v, err) => {
          if (done) return; done = true; es.close();
          err ? reject(err) : resolve(v);
        };
        const cancel = () => finish({ __cancelled: true, processed, total });

        es.addEventListener('progress', e => {
          sawEvent = true;
          const p = JSON.parse(e.data);
          if (p.phase === 'shortlist') { total = p.candidates; renderProgress({ total, processed: 0, analysed: 0, found: 0, cancel }); }
          else if (p.phase === 'symbol') {
            processed = p.processed; analysed = p.analysed;
            renderProgress({ total: p.total, processed, analysed, found: p.found, symbol: p.symbol, cancel });
          } else if (p.phase === 'row') {
            // Arrival order, not final rank — the server sorts by tier on completion and
            // the result event replaces these. Painting is throttled so 300 events do not
            // become 300 full table repaints.
            lastRows.push(p.row);
            if (Date.now() - lastPaint > 300) { lastPaint = Date.now(); paintRows(); }
          }
        });
        es.addEventListener('result', e => { sawEvent = true; finish(JSON.parse(e.data)); });
        es.addEventListener('failed', e => { sawEvent = true; finish(JSON.parse(e.data)); });
        es.addEventListener('error', () => {
          // EventSource retries on its own; a scan must not silently restart, so close and
          // either fall back (nothing arrived yet) or surface what we have.
          if (done) return;
          es.close();
          if (!sawEvent) { done = true; api(query()).then(resolve, reject); }
          else finish({ ok: false, error: 'the scan stream was interrupted' });
        });
      });
    }

    // Progress panel: a determinate bar plus the counts that actually matter — how far
    // through the shortlist, how many completed real analysis, how many qualified.
    function renderProgress({ total, processed, analysed, found, symbol, cancel }) {
      const meta = id('meta');
      const pct = total ? Math.round(processed / total * 100) : 0;
      if (!meta.classList.contains('scanprog')) {
        meta.className = 'scanprog';
        meta.innerHTML = `<div class="sp-head"><span class="sp-phase"></span><span class="grow"></span>`
          + `<span class="sp-count"></span><button type="button" class="fbtn sp-cancel">Cancel</button></div>`
          + `<div class="sp-track"><div class="sp-bar"></div></div><div class="sp-sub"></div>`;
        meta.querySelector('.sp-cancel').addEventListener('click', () => cancel());
      }
      meta.querySelector('.sp-phase').textContent = 'Stage 2 — analysing the shortlist';
      meta.querySelector('.sp-count').textContent = `${processed} / ${total}`;
      meta.querySelector('.sp-bar').style.width = pct + '%';
      meta.querySelector('.sp-sub').innerHTML =
        `${analysed} analysed · <b>${found}</b> qualifying so far`
        + (symbol ? ` · <span class="sp-sym">${esc(symbol)}</span>` : '')
        + (found ? ' · <i>listed in arrival order until the scan finishes</i>' : '');
    }

    // Repaint the shortlist through the client filter without re-scanning.
    function paintRows() {
      const body = id('body');
      const total = lastRows.length;
      if (!total) {
        if (filterBar) filterBar.setCount(0, 0);
        // Stage 2 already covers the whole Stage-1 shortlist, so "raise candidates" is no
        // longer the advice; what matters is whether the pass actually completed.
        body.innerHTML = emptyRow(cols, { icon: '○', title: 'Nothing close to a breakout in this selection',
          body: `No candidate sits within ${lastThresholds?.maxDistPct}% of its level — an empty table is an honest answer.`
            + (lastCoverage && lastCoverage.analysed < lastCoverage.candidates
              ? ` Note that Stage 2 only completed <b>${lastCoverage.analysed} of ${lastCoverage.candidates}</b> shortlisted names, so this is not yet a full read — press <b>Scan</b> again to carry on.`
              : ' Widen the timeframe, or relax the filters.') });
        return;
      }
      let rows = filterBar ? filterBar.apply(lastRows) : lastRows;
      if (filterBar) filterBar.setCount(rows.length, total);
      if (sorter) rows = sorter.apply(rows);       // filter first, then order
      if (!rows.length) {
        body.innerHTML = emptyRow(cols, { icon: '⊘', kind: 'warn', title: `All ${total} candidates are hidden by your filters`,
          body: 'Press <b>Reset</b> on the filter bar above to see them again.' });
        return;
      }
      if (mode === 'patterns') {
        body.innerHTML = rows.map(x => `<tr>
          <td class="sym">${esc(x.symbol)}</td><td class="num">${fmt(x.price)}</td>
          <td><b>${esc(x.pattern)}</b></td><td>${esc(x.timeframe)}</td>
          <td class="${x.status === 'Confirmed' ? 'good' : 'warn'}"><b>${esc(x.status)}</b></td>
          ${tierCell(x)}
          <td class="num"><b>${fmt(x.breakoutLevel)}</b><div class="ezone">${esc(x.levelLabel)}</div></td>
          <td class="num rr">${num(x.distPct)}%</td>
          <td><span class="st ${rCls(x.readiness)}">${esc(x.readiness)}</span></td>
          <td class="num">${x.confidence}%</td><td class="num"><b>${x.score}</b>/10</td>
          <td class="num">${fmt(x.target)}</td><td>${esc(x.stage)}</td><td class="num">${fmt(x.rvol)}</td>
          ${whyCell(x)}</tr>`).join('');
      } else {
        body.innerHTML = rows.map(x => `<tr>
          <td class="sym">${esc(x.symbol)}</td><td class="num">${fmt(x.price)}</td>
          <td><b>${esc(x.type)}</b></td><td>${esc(x.timeframe)}</td>
          <td class="${x.verdict === 'BUY-READY' ? 'good' : 'warn'}"><b>${esc(x.verdict)}</b></td>
          ${tierCell(x)}
          <td class="num"><b>${fmt(x.breakoutLevel)}</b></td>
          <td class="num rr">${num(x.distPct)}%</td>
          <td><span class="st ${rCls(x.readiness)}">${esc(x.readiness)}</span></td>
          <td class="num">${fmt(x.invalidation)}</td>
          <td class="num">${x.targets?.length ? x.targets.join(' / ') : '—'}${x.rr ? ` <small>(${x.rr}R)</small>` : ''}</td>
          <td class="num">${fmt(x.confidence)}%</td><td class="num"><b>${fmt(x.score)}</b>/10</td>
          ${whyCell(x)}</tr>`).join('');
      }
    }

    let wired = false;
    return {
      start() {
        if (!wired) {
          wired = true;
          if (!filterBar) { filterBar = makeFilterBar(prefix, brkFilterControls(mode), paintRows); id('filters').append(filterBar.el); }
          if (!sorter) sorter = makeSortable(prefix, id('table'), mode === 'patterns'
            ? [{ key: 'symbol', type: 'text' }, { key: 'price' }, { key: 'pattern', type: 'text' },
               { key: 'timeframe', type: 'text' }, { order: ORD.status, key: 'status' },
               { order: ORD.tier, key: 'tier' }, { key: 'breakoutLevel' }, { key: 'distPct' },
               { order: ORD.readiness, key: 'readiness' }, { key: 'confidence' }, { key: 'score' },
               { key: 'target' }, { key: 'stage', type: 'text' }, { key: 'rvol' }, null]
            : [{ key: 'symbol', type: 'text' }, { key: 'price' }, { key: 'type', type: 'text' },
               { key: 'timeframe', type: 'text' }, { key: 'verdict', type: 'text' },
               { order: ORD.tier, key: 'tier' }, { key: 'breakoutLevel' }, { key: 'distPct' },
               { order: ORD.readiness, key: 'readiness' }, { key: 'invalidation' }, { val: T1 },
               { key: 'confidence' }, { key: 'score' }, null],
            paintRows);
          id('run').addEventListener('click', run);
          // Changing a SERVER filter (region/timeframe/pattern) invalidates the table — a
          // fresh two-stage scan is required — rather than silently leaving stale rows. The
          // client FilterBar above just narrows what a scan already returned.
          [id('region'), id('tf'), mode === 'patterns' ? id('pattern') : id('type')].forEach(sel =>
            sel.addEventListener('change', () => {
              lastRows = []; if (filterBar) filterBar.setCount(0, 0);
              id('body').innerHTML = '';
              id('skipped').innerHTML = '';
              id('meta').textContent = 'Filters changed — press Scan.';
            }));
        }
      },
      stop() {},
    };
  }

  // ---------- Cached Data ----------
  // Entirely local: answers "does analysing this cost a request?" without contacting any
  // provider, which is the point — you check before you spend.
  function makeCache() {
    const combo = makeCombo('cache', () => check());
    const esc = combo.esc;
    let wired = false;

    async function check() {
      const sym = $('#cache-symbol').value.trim();
      if (!sym) return;
      let r;
      try { r = await api('/api/cache/cost?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      const v = $('#cache-verdict');
      if (!r?.ok) { v.innerHTML = `<span class="tag status-delayed">${esc(r?.error || 'lookup failed')}</span>`; return; }
      v.innerHTML = `<span class="tag ${r.free ? 'status-live' : 'status-delayed'}"><b>${esc(r.symbol)}</b> — ${r.free ? 'FREE' : r.cost + ' request(s)'}</span>`
        + `<span class="tag">${esc(r.verdict)}</span>`
        + (r.blockedForSec ? `<span class="tag status-delayed">${esc(r.provider)} blocked for ${r.blockedForSec}s</span>` : '');
      refresh();
    }

    async function refresh() {
      let r;
      try { r = await api('/api/cache'); } catch (e) { return; }
      $('#cache-updated').textContent = 'updated ' + new Date().toLocaleTimeString();

      const d = $('#cache-tiles'); d.innerHTML = '';
      const tile = (k, val, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(val))); d.append(t); };
      tile('Symbols cached', r.totals.symbols);
      tile('Free to analyse', r.totals.freeSymbols, r.totals.freeSymbols ? 'good' : '');
      tile('Windows held', r.totals.windows);
      tile('NSE session', r.session.nseOpen ? 'open' : 'shut', r.session.nseOpen ? 'good' : '');
      tile('Next open in', r.session.nseOpen ? '—' : Math.floor(r.session.nextOpenInMin / 60) + 'h ' + (r.session.nextOpenInMin % 60) + 'm');

      renderTable($('#cache-providers'), `<tr><th>Provider</th><th>State</th><th class="num">Concurrency</th>
        <th class="num">Min gap</th><th class="num">Max / min</th></tr>`
        + r.providers.map(p => `<tr><td><b>${esc(p.provider)}</b></td>
            <td class="${p.blockedForSec ? 'bad' : 'good'}">${p.blockedForSec ? 'rate limited — ' + p.blockedForSec + 's left' : 'ready'}</td>
            <td class="num">${p.concurrency}</td><td class="num">${p.minGapMs}ms</td><td class="num">${p.maxPerMin}</td></tr>`).join(''));

      renderTable($('#cache-symbols'), r.symbols.length
        ? `<tr><th>Symbol</th><th>Market</th><th>Cached windows</th><th class="num">Next analysis</th><th>Missing</th><th class="num">Soonest expiry</th></tr>`
          + r.symbols.map(x => {
            const soon = x.windows.length ? Math.min(...x.windows.map(w => w.expiresInMin)) : 0;
            return `<tr><td><b>${esc(x.symbol)}</b></td><td>${x.market === 'india' ? '\ud83c\uddee\ud83c\uddf3 NSE' : '\ud83c\uddfa\ud83c\uddf8 US'}</td>
              <td>${x.windows.map(w => `${esc(w.interval)} <small>(${w.bars} bars, ${w.ageMin}m old)</small>`).join(' \u00b7 ')}</td>
              <td class="num ${x.free ? 'good' : 'warn'}"><b>${x.free ? 'FREE' : x.nextAnalysisCost + ' req'}</b></td>
              <td>${x.missing?.length ? esc(x.missing.join(', ')) : '\u2014'}</td>
              <td class="num">${soon >= 60 ? Math.floor(soon / 60) + 'h ' + (soon % 60) + 'm' : soon + 'm'}</td></tr>`;
          }).join('')
        : `<tr><td class="hint">Nothing cached yet — analyse a symbol and it will appear here.</td></tr>`);

      $('#cache-note').textContent = 'Held in data/history_cache.json and restored on restart. This tab makes no upstream requests.';
    }

    return {
      start() {
        if (!wired) {
          wired = true;
          combo.wire();
          $('#cache-check').addEventListener('click', () => { combo.close(); check(); });
          $('#cache-refresh').addEventListener('click', refresh);
        }
        refresh();
      },
      stop() {},
    };
  }

  // ---------- Dashboard symbol picker ----------
  // Same combobox as the analysis tabs. Picking a symbol switches the TradingView chart
  // to it (the existing best-effort CCP switch) and pins the Signal Summary to it.
  const dashCombo = makeCombo('dash', () => loadDashSymbol());
  async function loadDashSymbol() {
    const sym = $('#dash-symbol').value.trim();
    if (!sym) return;
    $('#dash-state').textContent = 'loading ' + sym + '…';
    DASHBOARD_SYMBOL = sym;
    try {
      const r = await api('/api/chart/symbol', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      });
      $('#dash-state').textContent = r?.ok ? 'showing ' + sym : 'chart switch failed — ' + (r?.error || 'bring a chart tab to the front');
    } catch (e) { $('#dash-state').textContent = 'chart switch failed — ' + e.message; }
    poll();                       // refresh the panel immediately, no data-provider request involved
  }
  dashCombo.wire();
  $('#dash-load').addEventListener('click', () => { dashCombo.close(); loadDashSymbol(); });

  // Start Here — reads /api/setup and renders live "what's configured" tiles.
  function makeStart() {
    const tile = (k, v, cls, sub) => {
      const t = el('div', 'dtile' + (cls ? ' ' + cls : ''));
      t.append(el('div', 'dk', k), el('div', 'dv', v));
      if (sub) t.append(el('div', 'start-sub', sub));
      return t;
    };
    async function render() {
      const box = $('#start-setup'), hint = $('#start-setup-hint');
      if (!box) return;
      let s; try { s = await api('/api/setup'); } catch { s = null; }
      box.innerHTML = '';
      if (!s) { hint.textContent = 'Could not read setup status — is the dashboard server running?'; return; }
      const cdp = s.cdp || {}, up = s.nse || {}, al = s.us || {};
      box.append(tile('TradingView (CDP)',
        cdp.up ? 'Connected' : 'Not connected', cdp.up ? 'good' : 'bad',
        cdp.up ? `${cdp.chartTabs || 0} chart tab(s) open · live chart reads work`
               : 'Run  npm run tv:debug  to relaunch TradingView with CDP on :9222'));
      // India history needs no credential — the provider's historical-candle endpoints are
      // open. The token buys exactly one thing: the real circuit band at TPO Confirm, whose
      // market-quote endpoint does 401 without it. The old copy claimed it gated all NSE
      // history, which is what made a missing token look like a dead dashboard.
      box.append(tile('NSE data token · India (optional)',
        up.configured ? 'Configured' : 'Not set', up.configured ? 'good' : '',
        up.configured ? 'Real NSE circuit band at Confirm. History, backtest and regime work either way.'
               : 'Not needed for analysis — NSE history, the 1-min backtest and the regime model all work without it. '
                 + 'It only adds the real circuit band at TPO Confirm; without it Confirm uses the assumed band.'));
      box.append(tile('US data keys (optional)',
        al.configured ? `Configured · ${al.feed} feed` : 'Not set', al.configured ? 'good' : 'warn',
        al.configured ? 'US price history for the Pattern / VCP / Elliott / Breakout tabs'
               : 'Add US data keys in .env (see .env.example) to analyse US symbols. Without them US analysis reports "no history source".'));
      hint.textContent = 'Green = ready. Amber items are optional — they only affect the tabs that need them; the TPO scanners and journal work with no keys.';
    }
    return { start() { render(); }, stop() {} };
  }

  const controllers = {
    start: makeStart(),
    patterns: makePatterns(),
    vcp: makeVCP(),
    elliott: makeElliott(),
    brk: makeBreakouts('brk', 'patterns'),
    brk2: makeBreakouts('brk2', 'methods'),
    cache: makeCache(),
    tpo: makeTPO('tpo', '/api/tpo/scan'),
    'tpo-usa': makeTPO('utpo', '/api/tpo/scan/usa'),
    testing: makeTesting(),
    analytics: makeAnalytics(),
  };

  // The rail is a real tablist: aria-selected marks the view, and only the active
  // tab is a tab stop (roving tabindex) so Tab moves past the rail in one press
  // instead of twelve, with Left/Right/Home/End moving inside it.
  // Both header rails scroll sideways with `scrollbar-width:none` (DESIGN.md's
  // mobile nav rule). Measured at 375px the nav rail is 1074px of content in 355px
  // and the status rail 497px in 177px, so the theme toggle, the live switch and
  // eight tabs were reachable but entirely unadvertised. A hairline-soft fade on
  // whichever side still has content restores the cue without adding chrome.
  const rails = ['#tabs', '.status'].map(sel => $(sel)).filter(Boolean);
  function railFades() {
    rails.forEach(r => {
      const max = r.scrollWidth - r.clientWidth;
      r.classList.toggle('has-start', max > 1 && r.scrollLeft > 1);
      r.classList.toggle('has-end', max > 1 && r.scrollLeft < max - 1);
    });
  }
  rails.forEach(r => r.addEventListener('scroll', railFades, { passive: true }));
  addEventListener('resize', railFades);

  function show(view, opts = {}) {
    if (!views[view]) view = 'start';
    tabs.forEach(t => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    Object.entries(views).forEach(([k, elm]) => elm && elm.classList.toggle('hidden', k !== view));
    Object.entries(controllers).forEach(([k, c]) => (k === view ? c.start() : c.stop()));
    const active = tabs.find(t => t.dataset.view === view);
    // A twelve-tab rail overflows below ~1100px and its scrollbar is hidden by
    // design, so an activated tab could sit off-screen with nothing to say so.
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    if (opts.focusTab) active?.focus();
    // The view belongs in the URL: reload, browser back and a bookmarked tab all
    // worked against you before, since every load landed on Start Here. A tab you
    // chose is a history entry (so Back returns to the tab you came from); the
    // restore on load only rewrites the URL, or Back would need two presses to leave.
    if (!opts.fromHash && location.hash.slice(1) !== view) {
      history[opts.initial ? 'replaceState' : 'pushState'](null, '', '#' + view);
    }
    try { localStorage.setItem('lastView', view); } catch {}
    railFades();
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
  addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (views[v]) show(v, { fromHash: true });
  });
  $('#tabs').addEventListener('keydown', e => {
    const i = tabs.findIndex(t => t === document.activeElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    show(tabs[to].dataset.view, { focusTab: true });
  });
  // Open the linked view, else the one you were last on, else Start Here.
  const stored = (() => { try { return localStorage.getItem('lastView'); } catch { return null; } })();
  const initial = views[location.hash.slice(1)] ? location.hash.slice(1)
    : views[stored] ? stored : 'start';
  show(initial, { initial: true });
  railFades();
})();
