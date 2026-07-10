// app.js — intraday dashboard frontend. Vanilla JS, no deps.
const $ = s => document.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
const api = (p, opt) => fetch(p, opt).then(r => r.json());

let CONFIG = null, POLL_MS = 7000, timer = null;

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

  const controllers = {
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
