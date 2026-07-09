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
  const tile = (k, v, cls) => { if (v == null || v === '') return; const t = el('div', 'dtile' + (cls ? ' ' + cls : '')); t.append(el('div', 'dk', k), el('div', 'dv', String(v))); d.append(t); };
  const biasCls = m.marketBias === 'BULLISH' ? 'good' : m.marketBias === 'BEARISH' ? 'bad' : 'warn';
  tile('Market Bias', m.marketBias, biasCls);
  tile('Long / Short', m.longShort);
  tile('Signal Strength', m.signalStrength != null ? m.signalStrength + '/100' : null);
  tile('Confidence', m.confidence, m.confidence === 'High' ? 'good' : m.confidence === 'None' ? 'warn' : '');
  tile('Trend', m.trend, m.trend === 'Up' ? 'good' : m.trend === 'Down' ? 'bad' : 'warn');
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
  const views = { dashboard: $('#view-dashboard'), tpo: $('#view-tpo'), 'tpo-usa': $('#view-tpo-usa') };
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
        body.innerHTML = `<tr><td colspan="11" class="tpo-empty">No high-quality setups right now (or market closed). Thresholds live in config/markets.json → tpo.${r.market ? ' [' + r.market + ']' : ''}</td></tr>`;
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
          <td><span class="st st-${x.state}" title="${(x.stateNote || '').replace(/"/g, '&quot;')}">${x.state}</span><div class="ttime">${x.triggerTime || ''}</div></td>
          <td class="num">${x.entry}${zone}</td>
          <td class="num">${x.sl}</td>
          <td class="num">${x.targets.join(' / ')}${cap}</td>
          <td class="num rr">${x.rr}</td>
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

  const controllers = {
    tpo: makeTPO('tpo', '/api/tpo/scan'),
    'tpo-usa': makeTPO('utpo', '/api/tpo/scan/usa'),
  };

  function show(view) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
    Object.entries(views).forEach(([k, elm]) => elm && elm.classList.toggle('hidden', k !== view));
    Object.entries(controllers).forEach(([k, c]) => (k === view ? c.start() : c.stop()));
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
})();
