// app.js — intraday dashboard frontend. Vanilla JS, no deps.
const $ = s => document.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
const api = (p, opt) => fetch(p, opt).then(r => r.json());

let CONFIG = null, POLL_MS = 7000, timer = null;
// Symbol on the active TradingView chart — used to prefill the analysis tabs.
let CHART_SYMBOL = '';
// Symbol under analysis, shared by Pattern Analysis and VCP so switching methodology keeps
// you on the same name (and reuses the server-side history cache).
let SELECTED_SYMBOL = '';

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
  let snap; try { snap = await api('/api/snapshot'); } catch { snap = { status: { up: false } }; }
  if (snap.chart && snap.chart.symbol) CHART_SYMBOL = snap.chart.symbol;
  renderHealth(snap.status);
  renderSignals(snap.signals, snap.chart);
  renderScans(snap.watchlist || []);
  $('#pill-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
}

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

// ---------- signal summary ----------
function renderSignals(s, chart) {
  if (!s) { $('#signal-empty').classList.remove('hidden'); $('#signal-body').classList.add('hidden'); return; }
  $('#signal-empty').classList.add('hidden'); $('#signal-body').classList.remove('hidden');
  $('#sig-sym').textContent = s.symbol || '—';
  $('#sig-tf').textContent = s.interval || '';
  const b = $('#sig-bias'); b.textContent = s.bias; b.className = 'bias ' + s.bias;
  $('#sig-close').textContent = s.close != null ? s.close : '—';
  const chg = $('#sig-chg');
  if (s.changePct != null) { chg.textContent = (s.changePct > 0 ? '+' : '') + s.changePct + '%'; chg.className = 'chg ' + (s.changePct >= 0 ? 'up' : 'down'); }
  else chg.textContent = '';

  // intraday decision metrics
  const d = $('#sig-decision'); d.innerHTML = '';
  const m = s.metrics || {};
  // one-line verdict — the 2-second read
  const v = $('#sig-verdict');
  if (v) {
    v.textContent = m.verdict || '';
    v.className = 'verdict ' + (m.entryReadiness === 'Ready' ? 'good' : m.entryReadiness === 'Avoid' ? 'bad' : 'warn');
  }
  const tile = (k, v, cls) => { if (v == null || v === '') return; const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(v))); d.append(t); };
  const biasCls = m.marketBias === 'BULLISH' ? 'good' : m.marketBias === 'BEARISH' ? 'bad' : 'warn';
  tile('Market Bias', m.marketBias, biasCls);
  tile('Long / Short', m.longShort);
  tile('Signal Strength', m.signalStrength != null ? m.signalStrength + '/100' : null);
  tile('Confidence', m.confidence, m.confidence === 'High' ? 'good' : m.confidence === 'None' ? 'warn' : '');
  tile('Conviction', m.conviction != null ? m.conviction + '/100' : null, m.conviction >= 70 ? 'good' : m.conviction < 40 ? 'warn' : '');
  tile('Trend', m.trend, m.trend === 'Up' ? 'good' : m.trend === 'Down' ? 'bad' : 'warn');
  tile('Location', m.location, m.location === 'At value' ? 'good' : /Extended/.test(m.location || '') ? 'bad' : '');
  tile('Session', m.sessionPhase, /Late|Closed|Midday/.test(m.sessionPhase || '') ? 'warn' : 'good');
  tile('Volume Confirm', m.volumeConfirmation, /Confirmed/.test(m.volumeConfirmation || '') ? 'good' : /Weak|n\/a/.test(m.volumeConfirmation || '') ? 'warn' : '');
  tile('Risk Level', m.riskLevel, m.riskLevel === 'Low' ? 'good' : m.riskLevel === 'High' ? 'bad' : 'warn');
  tile('Trade Quality', m.tradeQuality, m.tradeQuality === 'A' ? 'good' : m.tradeQuality === '—' ? 'warn' : '');
  tile('Entry Readiness', m.entryReadiness, m.entryReadiness === 'Ready' ? 'good' : m.entryReadiness === 'Avoid' ? 'bad' : 'warn');
  if (m.bestSetup) { const t = el('div', 'dtile wide'); t.append(el('div', 'dk', 'Best Setup'), el('div', 'dv', m.bestSetup)); d.append(t); }
  if (m.avoidReason) { const t = el('div', 'dtile wide bad'); t.append(el('div', 'dk', '⚠ Avoid Trade'), el('div', 'dv', m.avoidReason)); d.append(t); }

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
  (m.timeframes || []).forEach(tf => tfs.append(el('span', 'chip', tf)));
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
  const views = { dashboard: $('#view-dashboard'), tpo: $('#view-tpo'), 'tpo-usa': $('#view-tpo-usa'),
    patterns: $('#view-patterns'), vcp: $('#view-vcp'), elliott: $('#view-elliott'),
    testing: $('#view-testing'), analytics: $('#view-analytics') };
  const tabs = [...document.querySelectorAll('#tabs .tab')];

  function makeTPO(prefix, endpoint) {
    const id = s => document.getElementById(prefix + '-' + s);
    let tpoMs = 30000, started = false, autoOn = true;
    let cycleTimer = null, tickTimer = null, nextAt = 0, scanning = false;

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
      meta.textContent = 'Scanning…';
      let r; try { r = await api(endpoint); } catch (e) { meta.textContent = 'Scan failed: ' + e.message; return; }
      if (r.error) { meta.textContent = 'Scan error: ' + r.error; return; }
      meta.innerHTML = '';
      const st = r.dataStatus || 'unknown';
      const stLabel = st === 'live' ? '🟢 LIVE' : st === 'delayed' ? ('🔴 delayed' + (r.delayMin ? ' ~' + r.delayMin + 'm' : '')) : st === 'closed' ? '⚪ market closed' : 'status —';
      meta.append(el('span', 'tag status-' + st, stLabel));
      const tag = (k, v) => meta.append(el('span', 'tag', `${k} <b>${v}</b>`));
      tag('universe', r.universe);
      if (r.indexChangePct != null) tag(r.indexLabel || 'index', (r.indexChangePct >= 0 ? '+' : '') + r.indexChangePct + '%');
      tag('setups', r.count);
      if (r.session && r.session.minsToClose != null) tag('to close', r.session.minsToClose + 'm');
      tag('updated', new Date(r.ts).toLocaleTimeString());
      body.innerHTML = '';
      if (!r.rows.length) {
        body.innerHTML = `<tr><td colspan="13" class="tpo-empty">No high-quality setups right now (or market closed). Thresholds live in config/markets.json → tpo.${r.market ? ' [' + r.market + ']' : ''}</td></tr>`;
        note.textContent = r.note || ''; return;
      }
      r.rows.forEach(x => {
        const tr = el('tr');
        const zone = Array.isArray(x.entryZone) ? `<div class="ezone">zone ${x.entryZone[0]}–${x.entryZone[1]}</div>` : '';
        const cap = x.circuit && x.circuit.capped ? ' <span class="capped" title="Target/SL clamped to circuit band">⛒</span>' : '';
        tr.innerHTML = `
          <td class="sym">${x.symbol}</td>
          <td class="num">${x.ltp}</td>
          <td><span class="sig ${x.signal}">${x.signal}</span></td>
          <td><span class="setup setup-${x.setup || ''}">${x.setup || '—'}</span></td>
          <td><span class="st st-${x.state}" title="${(x.stateNote || '').replace(/"/g, '&quot;')}">${x.state}</span><div class="ttime">${x.triggerTime || ''}</div></td>
          <td class="num">${x.entry}${zone}</td>
          <td class="num">${x.sl}</td>
          <td class="num">${x.targets.join(' / ')}${cap}</td>
          <td class="num rr">${x.rr}</td>
          <td class="num"><span class="eq ${x.entryQuality >= 65 ? 'good' : x.entryQuality < 45 ? 'low' : ''}">${x.entryQuality ?? '—'}</span></td>
          <td><span class="conf ${x.confidence}">${x.confidence} · ${x.score}</span></td>
          <td class="reason">${x.reason}</td>`;
        const td = el('td'), b = el('button', 'btn-confirm', 'Confirm');
        b.title = 'Load on chart & read live on-chart levels + real circuit';
        b.addEventListener('click', () => confirm(x, b));
        td.append(b); tr.append(td); body.append(tr);
      });
      note.textContent = r.note || '';
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
          circ = `<div class="circ ok"><b>Real NSE circuit (Upstox):</b> lower ${r.circuit.lower} · upper ${r.circuit.upper}`
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
    const gateTag = (name, g) => {
      const cls = g.pass === true ? 'status-live' : g.pass === false ? 'status-delayed' : 'status-closed';
      const verdict = g.pass === true ? 'PASS' : g.pass === false ? 'FAIL' : 'n<20';
      return `<span class="tag ${cls}">${name} ${fmt(g.value)} / ${g.target} · <b>${verdict}</b></span>`;
    };
    async function refresh() {
      let r; try { r = await api('/api/test/summary'); } catch (e) { $('#test-note').textContent = 'Failed: ' + e.message; return; }
      $('#test-updated').textContent = 'updated ' + new Date(r.ts).toLocaleTimeString();
      const g = r.gates;
      $('#test-gates').innerHTML =
        `<span class="tag">closed trades <b>${r.overall.trades}</b></span>`
        + gateTag('Profit Factor ≥', g.pf) + gateTag('Win Rate% ≥', g.wr) + gateTag('avg R:R ≥', g.rr)
        + (g.sampleOk ? '' : `<span class="tag">insufficient sample — gates activate at n≥${g.minN}</span>`);
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
      // breakdown tables
      const bd = $('#test-breakdown');
      const section = (title, obj) => Object.keys(obj || {}).length
        ? `<tr><th colspan="6">${title}</th></tr><tr><th></th><th class="num">n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th><th class="num">missed</th></tr>`
          + Object.entries(obj).map(([k, s]) =>
            `<tr><td>${k}</td><td class="num">${s.trades}</td><td class="num">${fmt(s.profitFactor)}</td><td class="num">${fmt(s.winRate)}</td><td class="num">${fmt(s.expectancyR)}</td><td class="num">${s.missed}</td></tr>`).join('')
        : '';
      bd.innerHTML = section('By market', r.byMarket) + section('By setup', r.bySetup) + section('By confidence', r.byConfidence)
        || '<tr><td class="tpo-empty">Journal empty — plans record automatically while the TPO scanners run during market hours.</td></tr>';
      // recent journal
      $('#test-body').innerHTML = (r.recent || []).map(t => `
        <tr><td>${t.date}</td><td>${t.market}</td><td class="sym">${t.symbol}</td>
        <td><span class="setup setup-${t.setup}">${t.setup}</span></td>
        <td><span class="sig ${t.signal}">${t.signal}</span></td>
        <td class="num">${t.entry}</td><td class="num">${t.sl}</td><td class="num">${t.targets?.[0] ?? '—'}</td>
        <td class="num">${t.rr}</td><td class="num">${fmt(t.entryQuality)}</td>
        <td>${t.status}</td><td>${t.outcome || (t.status === 'MISSED' ? 'never filled' : '—')}</td>
        <td class="num ${t.rMultiple > 0 ? 'rr' : ''}">${t.rMultiple != null ? (t.rMultiple > 0 ? '+' : '') + t.rMultiple : '—'}</td></tr>`).join('')
        || '<tr><td colspan="13" class="tpo-empty">No journaled plans yet.</td></tr>';
      $('#test-note').textContent = 'Only plans whose state reached VALID (a fillable entry) count toward PF / win-rate; the rest are “missed”. No mock data — everything above is recorded from live scans.';
    }
    async function backtest(btn) {
      btn.disabled = true; btn.textContent = 'Backtesting… (1-min candles)';
      const box = $('#test-bt'); box.classList.remove('hidden'); box.innerHTML = '<h3>Running India 1-minute backtest…</h3>';
      let r; try { r = await api('/api/test/backtest', { method: 'POST' }); } catch (e) { r = { ok: false, error: e.message }; }
      btn.disabled = false; btn.textContent = 'Run India 1-min backtest';
      if (!r.ok) { box.innerHTML = `<h3>Backtest unavailable</h3><div class="prow">${r.error}</div>`; return; }
      const s = r.summary, g = r.gates;
      box.innerHTML = `<h3>India backtest — ${r.tested} plans @ ${r.resolution}${r.skipped ? ` · ${r.skipped} skipped` : ''}</h3>`
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
        <line x1="${P}" y1="${Y(0)}" x2="${W - P}" y2="${Y(0)}" stroke="#39424e" stroke-dasharray="4 4"/>
        <path d="${area(mc.bands.p95, mc.bands.p5)}" fill="#4c8dff18" stroke="none"/>
        <path d="${area(mc.bands.p75, mc.bands.p25)}" fill="#4c8dff2e" stroke="none"/>
        <path d="${line(mc.bands.p50)}" fill="none" stroke="#4c8dff" stroke-width="2"/>
        <text x="${P}" y="14" fill="#8b95a3" font-size="11">Bootstrapped equity (R) — ${mc.runs} runs × ${mc.steps} trades · bands p5–p95 / p25–p75 / median</text>
        <text x="${P}" y="${Y(0) - 4}" fill="#8b95a3" font-size="10">0R</text>
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
        <line x1="${P}" y1="${Y(1.5)}" x2="${W - P}" y2="${Y(1.5)}" stroke="#3a5f46" stroke-dasharray="3 4"/>
        <path d="${v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join('')}" fill="none" stroke="#57c99b" stroke-width="2"/>
        <text x="${P}" y="12" fill="#8b95a3" font-size="11">Rolling Profit Factor (20-trade window) — dashed line = 1.5 gate</text>
      </svg>`;
    }
    async function refresh() {
      const risk = $('#ana-risk').value;
      $('#ana-updated').textContent = 'computing…';
      let r; try { r = await api('/api/analytics?riskPct=' + risk); } catch (e) { $('#ana-note').textContent = 'Failed: ' + e.message; return; }
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
        $('#ana-mc-chart').innerHTML = mcSvg(mc);
      } else { tile(mt, 'Monte Carlo', `insufficient sample (${mc.n}/${mc.need} closed trades)`, 'warn'); $('#ana-mc-chart').innerHTML = ''; }
      // HMM
      const ht = $('#ana-hmm-tiles'); ht.innerHTML = '';
      const hm = r.regime, htab = $('#ana-hmm-table');
      if (hm.ok) {
        tile(ht, 'Current regime', hm.current.label, /Uptrend/.test(hm.current.label) ? 'good' : /volatility|Downtrend/.test(hm.current.label) ? 'bad' : 'warn');
        tile(ht, 'Source', hm.source);
        htab.innerHTML = `<tr><th>Regime</th><th class="num">μ daily%</th><th class="num">σ daily%</th><th class="num">stickiness</th><th class="num">your n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th></tr>`
          + hm.states.map(s => {
            const p = hm.perRegime[s.label] || {};
            return `<tr${s.state === hm.current.state ? ' style="outline:1px solid #4c8dff55"' : ''}><td>${s.label}</td><td class="num">${s.meanDailyPct}</td><td class="num">${s.sdDailyPct}</td><td class="num">${s.stickiness}</td><td class="num">${fmt(p.n)}</td><td class="num">${fmt(p.pf)}</td><td class="num">${fmt(p.wr)}</td><td class="num">${fmt(p.expR)}</td></tr>`;
          }).join('');
      } else { tile(ht, 'HMM regime', hm.error, 'warn'); htab.innerHTML = ''; }
      // Robustness
      const rt = $('#ana-rob-tiles'); rt.innerHTML = '';
      const rb = r.robustness, rtab = $('#ana-rob-table');
      if (rb.ok) {
        tile(rt, 'Expectancy', `${rb.expectancyR}R ± ${rb.stderrR}`, rb.expectancy95[0] > 0 ? 'good' : rb.expectancy95[1] < 0 ? 'bad' : 'warn');
        tile(rt, '95% CI', `${rb.expectancy95[0]}R … ${rb.expectancy95[1]}R`);
        tile(rt, 'SQN', rb.sqn, rb.sqn >= 2 ? 'good' : rb.sqn < 1 ? 'warn' : '');
        rtab.innerHTML = `<tr><th>Threshold sensitivity</th><th class="num">n</th><th class="num">PF</th><th class="num">WR%</th><th class="num">Exp R</th></tr>`
          + rb.sensitivity.map(s => `<tr><td>${s.cut}</td><td class="num">${s.n}</td><td class="num">${fmt(s.pf)}</td><td class="num">${fmt(s.wr)}</td><td class="num">${fmt(s.expR)}</td></tr>`).join('');
        $('#ana-rob-chart').innerHTML = sparkline(rb.rollingPF || []);
      } else { tile(rt, 'Robustness', `insufficient sample (${rb.n}/${rb.need} closed trades)`, 'warn'); rtab.innerHTML = ''; $('#ana-rob-chart').innerHTML = ''; }
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
    }
    function paint() {
      box().innerHTML = sug.length
        ? sug.map((r, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}"
            aria-selected="${i === active}"><span class="s-sym">${esc(r.symbol)}</span>
            <span class="s-ex">${esc(r.exchange)}</span>
            <span class="s-desc">${esc(r.description)}</span></li>`).join('')
        : `<li class="s-none">No matching NSE / NASDAQ / NYSE / AMEX symbol.</li>`;
      box().classList.remove('hidden');
      input().setAttribute('aria-expanded', 'true');
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
    let autoRan = false, busy = false;

    async function run() {
      const sym = $('#pat-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#pat-note').textContent = `Fetching 4H / Daily / Weekly / Monthly history for ${sym}…`;
      let r;
      try { r = await api('/api/patterns?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#pat-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#pat-body').classList.add('hidden');
        $('#pat-empty').classList.remove('hidden');
        $('#pat-empty').textContent = `No analysis for ${sym} — ${r?.error || 'request failed'}`;
        $('#pat-src').textContent = '—'; $('#pat-note').textContent = '';
        return;
      }
      $('#pat-empty').classList.add('hidden');
      $('#pat-body').classList.remove('hidden');
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
      $('#pat-missing').innerHTML = r.overall.timeframesMissing.length
        ? `<span class="tag status-delayed">unavailable — ${r.overall.timeframesMissing.map(esc).join(' · ')}</span>` : '';

      // Timeframe analysis
      $('#pat-tf').innerHTML = `<tr><th>Timeframe</th><th class="num">Close</th><th class="num">Δ 20 bars</th>
        <th>Stage</th><th>Structure</th><th class="num">30-MA</th><th class="num">50-MA</th><th class="num">200-MA</th>
        <th class="num">ATR%</th><th class="num">rVol</th><th class="num">Bias</th><th class="num">Patterns</th></tr>`
        + r.timeframes.map(t => t.ok
          ? `<tr><td><b>${esc(t.label)}</b> <small>${t.bars} bars</small></td><td class="num">${fmt(t.close)}</td>
             <td class="num">${num(t.changePct)}%</td><td>${esc(t.stage.label)}</td><td>${esc(t.structure.label)}</td>
             <td class="num">${fmt(t.stage.ma)}</td><td class="num">${fmt(t.ma50)}</td><td class="num">${fmt(t.ma200)}</td>
             <td class="num">${fmt(t.atrPct)}</td><td class="num">${fmt(t.rvol)}</td>
             <td class="num">${num(t.dir)}</td><td class="num">${t.patterns.length}</td></tr>`
          : `<tr><td><b>${esc(t.label)}</b></td><td colspan="11" class="hint">unavailable — ${esc(t.error)}</td></tr>`).join('');

      // Stage analysis
      $('#pat-stages').innerHTML = `<tr><th>Timeframe</th><th>Stage</th><th>Phase</th><th class="num">Stage MA</th>
        <th class="num">MA slope %/5 bars</th><th class="num">Dist (ATR)</th><th class="num">Confidence</th><th>Read</th></tr>`
        + r.stages.map(s => `<tr><td>${esc(s.tf)}</td><td><b>${esc(s.label)}</b></td><td>${esc(s.phase)}</td>
            <td class="num">${fmt(s.ma)}</td><td class="num">${num(s.maSlopePct)}</td><td class="num">${num(s.distATR)}</td>
            <td class="num">${s.confidence}%</td><td>${esc(s.reason)}</td></tr>`).join('');

      // Pattern summary
      $('#pat-patterns').innerHTML = `<tr><th>Timeframe</th><th>Pattern</th><th>Bias</th><th>Status</th>
        <th class="num">Confidence</th><th class="num">Score</th><th>HTF aligned</th><th class="num">Target</th><th>Evidence</th></tr>`
        + (r.patterns.length
          ? r.patterns.map(p => `<tr><td>${esc(p.timeframe)}</td><td><b>${esc(p.pattern)}</b></td>
              <td class="${biasCls(p.bias)}">${esc(p.bias)}</td><td class="${statusCls(p.status)}"><b>${esc(p.status)}</b></td>
              <td class="num">${p.confidence}%</td><td class="num"><b>${p.score}</b>/10</td>
              <td class="${p.htfAligned === 'yes' ? 'good' : p.htfAligned === 'no' ? 'bad' : ''}">${esc(p.htfAligned)}</td>
              <td class="num">${fmt(p.levels?.target)}</td><td>${esc(p.detail)}</td></tr>`).join('')
          : `<tr><td colspan="9" class="hint">No pattern clears the 55% high-confidence bar on any timeframe — stand aside.</td></tr>`);

      // Key levels
      const lvl = (rows, kind) => rows.map(x => `<tr><td>${kind}</td><td class="num"><b>${x.price}</b></td>
        <td class="num">${num(x.distPct)}%</td><td class="num">${x.strength}</td><td class="num">${x.touches}</td>
        <td>${x.sources.map(esc).join(' · ')}</td></tr>`).join('');
      $('#pat-levels').innerHTML = `<tr><th>Type</th><th class="num">Level</th><th class="num">Distance</th>
        <th class="num">Strength</th><th class="num">Confluence</th><th>Built from</th></tr>`
        + lvl(r.levels.resistance.slice().reverse(), 'Resistance') + lvl(r.levels.support, 'Support');

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
        const want = SELECTED_SYMBOL || CHART_SYMBOL;
        if (want && $('#pat-symbol').value !== want) { $('#pat-symbol').value = want; autoRan = false; }
        if (!autoRan && $('#pat-symbol').value) { autoRan = true; run(); }
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
    let autoRan = false, busy = false;

    async function run() {
      const sym = $('#vcp-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#vcp-note').textContent = `Fetching history and ranking ${sym} against its market\u2026`;
      let r;
      try { r = await api('/api/vcp?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#vcp-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#vcp-body').classList.add('hidden');
        $('#vcp-empty').classList.remove('hidden');
        $('#vcp-empty').textContent = `No VCP analysis for ${sym} \u2014 ${r?.error || 'request failed'}`;
        $('#vcp-src').textContent = '\u2014'; $('#vcp-note').textContent = '';
        return;
      }
      $('#vcp-empty').classList.add('hidden');
      $('#vcp-body').classList.remove('hidden');
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
      $('#vcp-why').innerHTML = `<span class="tag ${r.verdict.label === 'BUY-READY' ? 'status-live' : 'status-delayed'}">${esc(r.verdict.why)}</span>`;

      // Trend Template checklist
      $('#vcp-tt').innerHTML = `<tr><th>#</th><th>Criterion</th><th>Result</th><th>Measured</th></tr>`
        + tt.criteria.map(c => `<tr><td>${c.id}</td><td>${esc(c.label)}</td>
            <td class="${c.pass ? 'good' : 'bad'}"><b>${c.pass ? '\u2713 pass' : '\u2717 fail'}</b></td>
            <td>${esc(c.actual)}</td></tr>`).join('');

      // Contractions
      if (v.ok) {
        $('#vcp-contractions').innerHTML = `<tr><th>#</th><th class="num">High</th><th class="num">Low</th>
          <th class="num">Depth</th><th class="num">vs prior</th><th class="num">Sessions</th><th class="num">Volume vs 50d</th></tr>`
          + v.contractions.map(c => `<tr><td>${c.n}</td><td class="num">${c.high}</td><td class="num">${c.low}</td>
              <td class="num"><b>${c.depthPct}%</b></td><td class="num">${c.vsPrior == null ? '\u2014' : c.vsPrior + '\u00d7'}</td>
              <td class="num">${c.bars}</td><td class="num">${fmt(c.volVs50d)}\u00d7</td></tr>`).join('');
        $('#vcp-base').innerHTML = `<span class="tag">footprint ${esc(v.footprint)}</span>`
          + `<span class="tag">base ${v.baseDepthPct}% deep / ${v.baseBars} sessions</span>`
          + `<span class="tag${v.dryUpVs50d != null && v.dryUpVs50d < 0.8 ? ' status-live' : ''}">volume dry-up ${fmt(v.dryUpVs50d)}\u00d7 the 50-day average</span>`
          + `<span class="tag">tightness ${v.tightnessPct}%</span>`
          + `<span class="tag">pivot ${v.pivot} (${num(v.distToPivotPct)}% away)</span>`;
      } else {
        $('#vcp-contractions').innerHTML = `<tr><td class="hint">${esc(v.error)}</td></tr>`;
        $('#vcp-base').innerHTML = '';
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
      $('#vcp-context').innerHTML = `<tr><th>Item</th><th>Value</th><th>Detail</th></tr>`
        + `<tr><td>Weekly stage</td><td><b>${esc(ctx.weeklyStage?.label || 'n/a')}</b></td><td>${ctx.weeklyStage ? ctx.weeklyStage.confidence + '% confidence, 30-week MA ' + ctx.weeklyStage.ma : 'weekly history unavailable'}</td></tr>`
        + `<tr><td>Daily stage</td><td><b>${esc(ctx.dailyStage.label)}</b></td><td>${ctx.dailyStage.confidence}% confidence, 30-day MA ${ctx.dailyStage.ma}</td></tr>`
        + `<tr><td>RS Rating</td><td><b>${r.rs.ok ? r.rs.rs : 'n/a'}</b></td><td>${r.rs.ok ? `3M ${r2s(r.rs.p3)}% \u00b7 6M ${r2s(r.rs.p6)}% \u00b7 1Y ${r2s(r.rs.p12)}% \u00b7 ranked against ${r.rs.universe} names` : esc(r.rs.error || '')}</td></tr>`
        + `<tr><td>RS method</td><td>percentile</td><td>${esc(r.rs.method || '')}${r.rs.filter ? ' \u2014 universe: ' + esc(r.rs.filter) : ''}</td></tr>`
        + `<tr><td>52-week range</td><td>${tt.low52} \u2013 ${tt.high52}</td><td>+${tt.aboveLowPct}% above the low, \u2212${tt.belowHighPct}% from the high</td></tr>`
        + `<tr><td>Moving averages</td><td>50 / 150 / 200</td><td>${tt.ma50} / ${tt.ma150} / ${tt.ma200} \u00b7 200-MA slope ${num(tt.ma200SlopePct)}% over 22 sessions</td></tr>`;

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
        const want = SELECTED_SYMBOL || CHART_SYMBOL;
        if (want && $('#vcp-symbol').value !== want) { $('#vcp-symbol').value = want; autoRan = false; }
        if (!autoRan && $('#vcp-symbol').value) { autoRan = true; run(); }
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
    let autoRan = false, busy = false;

    async function run() {
      const sym = $('#ew-symbol').value.trim();
      if (!sym || busy) return;
      SELECTED_SYMBOL = sym;
      busy = true;
      $('#ew-note').textContent = `Counting waves for ${sym} across four degrees\u2026`;
      let r;
      try { r = await api('/api/elliott?symbol=' + encodeURIComponent(sym)); }
      catch (e) { r = { ok: false, error: e.message }; }
      busy = false;
      $('#ew-updated').textContent = 'updated ' + new Date().toLocaleTimeString();
      if (!r || !r.ok) {
        $('#ew-body').classList.add('hidden');
        $('#ew-empty').classList.remove('hidden');
        $('#ew-empty').textContent = `No wave analysis for ${sym} \u2014 ${r?.error || 'request failed'}`;
        $('#ew-src').textContent = '\u2014'; $('#ew-note').textContent = '';
        return;
      }
      $('#ew-empty').classList.add('hidden');
      $('#ew-body').classList.remove('hidden');
      $('#ew-src').textContent = (r.market === 'india' ? '\ud83c\uddee\ud83c\uddf3 NSE' : '\ud83c\uddfa\ud83c\uddf8 US') + ' \u00b7 real OHLC';
      $('#ew-note').textContent = 'Source: ' + r.source + ' \u00b7 Scope: ' + r.scope;

      const p = r.primary;
      const d = $('#ew-primary'); d.innerHTML = '';
      const tile = (k, v, cls) => { const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(fmt(v)))); d.append(t); };
      tile('Symbol', r.symbol);
      tile('Price', r.price);
      if (!p) {
        tile('Count', 'none valid', 'warn');
        $('#ew-invalidation').innerHTML = '<span class="tag status-delayed">No rule-valid impulse or simple correction on any timeframe \u2014 an honest "no count", not a failure.</span>';
        ['ew-waves', 'ew-rules', 'ew-projections', 'ew-alternates', 'ew-personality'].forEach(id => { document.getElementById(id).innerHTML = ''; });
        $('#ew-nesting').innerHTML = '';
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
      $('#ew-invalidation').innerHTML =
        `<span class="tag status-live"><b>INVALIDATION ${p.invalidation}</b></span>`
        + `<span class="tag">${esc(p.invalidationRule)}</span>`
        + `<span class="tag">beyond this price the count is dead and must be re-labelled</span>`;

      $('#ew-waves').innerHTML = `<tr><th>Wave</th><th class="num">From</th><th class="num">To</th>
        <th class="num">Move</th><th class="num">Size (ATR)</th><th class="num">Bars</th><th>Fibonacci ratio</th></tr>`
        + p.waves.map(w => `<tr><td><b>${esc(w.label)}</b>${w.provisional ? ' <small>in progress</small>' : ''}</td>
            <td class="num">${w.from}</td><td class="num">${w.to}</td><td class="num">${num(w.movePct)}%</td>
            <td class="num">${w.atr}</td><td class="num">${w.bars}</td><td>${w.fib ? esc(w.fib) : '\u2014'}</td></tr>`).join('');

      $('#ew-rules').innerHTML = `<tr><th>Rule</th><th>Requirement</th><th>Result</th><th>Measured</th></tr>`
        + p.rules.map(x => `<tr><td>${x.id}</td><td>${esc(x.label)}</td>
            <td class="${x.pass ? 'good' : 'bad'}"><b>${x.pass ? '\u2713 holds' : '\u2717 broken'}</b></td>
            <td>${esc(x.detail)}</td></tr>`).join('');

      $('#ew-projections').innerHTML = p.projections.length
        ? `<tr><th>Target</th><th>Basis</th><th class="num">Price</th><th class="num">Distance</th></tr>`
          + p.projections.map(x => `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.basis)}</td>
              <td class="num">${x.price}</td><td class="num">${num(x.distPct)}%</td></tr>`).join('')
        : `<tr><td class="hint">No standard projection applies at this wave position.</td></tr>`;

      $('#ew-alternates').innerHTML = r.alternates.length
        ? `<tr><th>Structure</th><th>Direction</th><th>Position</th><th>Degree</th><th class="num">Confidence</th>
           <th class="num">Guideline</th><th class="num">Invalidation</th><th>Why it differs</th></tr>`
          + r.alternates.map(a => `<tr><td><b>${esc(a.structure)}</b></td><td>${esc(a.direction)}</td>
              <td>${esc(a.position)}</td><td>${esc(a.degree)}</td>
              <td class="num ${cCls(a.confidence)}">${a.confidence}%</td><td class="num">${a.guidelineScore}/10</td>
              <td class="num">${a.invalidation}</td><td>${esc(a.from || 'alternate reading')}</td></tr>`).join('')
        : `<tr><td class="hint">No other rule-valid count \u2014 unusually unambiguous, but still only one interpretation.</td></tr>`;

      $('#ew-nesting').innerHTML = `<tr><th>Timeframe</th><th>Degree</th><th>Structure</th><th>Position</th>
        <th>Direction</th><th class="num">Confidence</th><th class="num">Invalidation</th></tr>`
        + r.nesting.map(n => `<tr><td>${esc(n.tf)}</td><td>${esc(n.degree)}</td><td>${esc(n.structure)}</td>
            <td>${esc(n.position)}</td><td>${esc(n.direction)}</td>
            <td class="num ${cCls(n.confidence)}">${n.confidence}%</td><td class="num">${n.invalidation}</td></tr>`).join('')
        + `<tr><td colspan="7" class="${r.aligned ? 'good' : 'warn'}">${r.aligned
            ? 'All counted degrees agree on direction \u2014 nesting is consistent.'
            : 'Degrees disagree on direction \u2014 low conviction; defer to the higher degree.'}</td></tr>`;

      $('#ew-personality').innerHTML = `<tr><th>Check</th><th>Result</th><th>Detail</th></tr>`
        + p.personality.map(x => `<tr><td>${esc(x.check)}</td><td>${yn(x.pass)}</td><td>${esc(x.detail)}</td></tr>`).join('');

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
        const want = SELECTED_SYMBOL || CHART_SYMBOL;
        if (want && $('#ew-symbol').value !== want) { $('#ew-symbol').value = want; autoRan = false; }
        if (!autoRan && $('#ew-symbol').value) { autoRan = true; run(); }
      },
      stop() {},
    };
  }

  const controllers = {
    patterns: makePatterns(),
    vcp: makeVCP(),
    elliott: makeElliott(),
    tpo: makeTPO('tpo', '/api/tpo/scan'),
    'tpo-usa': makeTPO('utpo', '/api/tpo/scan/usa'),
    testing: makeTesting(),
    analytics: makeAnalytics(),
  };

  function show(view) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
    Object.entries(views).forEach(([k, elm]) => elm && elm.classList.toggle('hidden', k !== view));
    Object.entries(controllers).forEach(([k, c]) => (k === view ? c.start() : c.stop()));
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
})();
