// app.js — dashboard frontend. Vanilla JS, no deps.
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
    renderMarket('usa', CONFIG.markets.usa_swing);
  }
  wirePine(); wireJournal(); await loadJournal();
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
  const m = $('#sig-metrics'); m.innerHTML = '';
  const add = (k, v) => { if (v != null && v !== '') m.append(el('span', 'm', `<b>${k}</b>${v}`)); };
  add('RSI', s.rsi); add('BoP', s.bop);
  Object.entries(s.emas || {}).forEach(([k, v]) => add('EMA' + k, v));
  Object.entries(s.smas || {}).forEach(([k, v]) => add('SMA' + k, v));
  add('studies', s.studyCount);
  const list = $('#sig-list'); list.innerHTML = '';
  (s.signals || []).forEach(x => list.append(el('li', '', x)));
}

// ---------- market sections (scan + checklist) ----------
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
  fill('usa', CONFIG?.markets?.usa_swing?.exchanges || [], watchlist);
  function fill(key, exchanges, list) {
    const ul = $(`#${key}-scan`); ul.innerHTML = '';
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

// ---------- pine workspace ----------
function wirePine() {
  const out = $('#pine-console'), status = $('#pine-status');
  const busy = b => { ['#pine-read', '#pine-write', '#pine-compile'].forEach(s => $(s).disabled = b); status.textContent = b ? 'working…' : ''; };
  $('#pine-read').onclick = async () => { busy(true); try { const r = await api('/api/pine'); $('#pine-code').value = r.code || ''; out.className = 'console'; out.textContent = 'Read ' + ((r.code || '').split('\n').length) + ' lines from chart.'; } catch (e) { out.className = 'console err'; out.textContent = e.message; } busy(false); };
  $('#pine-write').onclick = async () => { busy(true); try { const r = await api('/api/pine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#pine-code').value }) }); out.className = 'console ' + (r.ok ? 'ok' : 'err'); out.textContent = r.ok ? 'Written to editor ✓ (attempt ' + r.attempt + ')' : 'Write not verified — bring the chart tab to front in TradingView.'; } catch (e) { out.className = 'console err'; out.textContent = e.message; } busy(false); };
  $('#pine-compile').onclick = async () => { busy(true); try { const r = await api('/api/pine/compile', { method: 'POST' }); out.className = 'console ' + (r.ok ? 'ok' : 'err'); out.textContent = (r.ok ? '✓ Compiled. ' : '✗ ') + (r.error || (r.recent || []).join('  ·  ')) + '   [markers: ' + r.errorMarkers + ']'; } catch (e) { out.className = 'console err'; out.textContent = e.message; } busy(false); };
}

// ---------- journal ----------
function wireJournal() {
  $('#jform').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { market: $('#j-market').value, symbol: $('#j-symbol').value, side: $('#j-side').value, setup: $('#j-setup').value, note: $('#j-note').value };
    if (!body.symbol && !body.note) return;
    await api('/api/journal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    $('#j-symbol').value = ''; $('#j-setup').value = ''; $('#j-note').value = '';
    loadJournal();
  });
}
async function loadJournal() {
  const list = await api('/api/journal').catch(() => []);
  const box = $('#jlist'); box.innerHTML = '';
  if (!list.length) { box.append(el('div', 'empty', 'No entries yet.')); return; }
  list.slice(0, 100).forEach(e => {
    const row = el('div', 'jrow');
    row.append(
      el('span', 't', new Date(e.ts).toLocaleString()),
      el('span', 's', (e.symbol || '') + (e.side ? ' · ' + e.side : '')),
      el('span', '', e.market === 'usa_swing' ? '🇺🇸' : '🇮🇳'),
      el('span', '', (e.setup ? '<b>' + e.setup + '</b> — ' : '') + (e.note || '')),
    );
    box.append(row);
  });
}

// ---------- tabs + TPO scanner ----------
(function wireTabsAndTPO() {
  const views = { dashboard: $('#view-dashboard'), tpo: $('#view-tpo') };
  const tabs = [...document.querySelectorAll('#tabs .tab')];
  let tpoMs = 30000, tpoStarted = false, autoOn = true;
  let cycleTimer = null, tickTimer = null, nextAt = 0, scanning = false;

  function show(view) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
    Object.entries(views).forEach(([k, elm]) => elm && elm.classList.toggle('hidden', k !== view));
    if (view === 'tpo') startTPO(); else stopTPO();
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

  // auto-refresh controls (top of TPO tab)
  $('#tpo-auto').addEventListener('change', e => {
    autoOn = e.target.checked;
    $('#tpo-auto-wrap').classList.toggle('paused', !autoOn);
    if (autoOn) runScan(); else clearTimeout(cycleTimer);
    tick();
  });
  $('#tpo-refresh').addEventListener('click', () => runScan());

  // chained scheduler — reschedules only after each scan finishes (no overlap)
  function schedule() {
    clearTimeout(cycleTimer);
    if (!autoOn) { nextAt = 0; return; }
    nextAt = Date.now() + tpoMs;
    cycleTimer = setTimeout(runScan, tpoMs);
  }
  function tick() {
    const nx = $('#tpo-next');
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

  async function startTPO() {
    if (tpoStarted) return; tpoStarted = true;
    try {
      const c = await api('/api/config');
      if (c?.tpo?.refreshSeconds) { tpoMs = c.tpo.refreshSeconds * 1000; $('#tpo-cycle').textContent = 'every ' + c.tpo.refreshSeconds + 's'; }
    } catch {}
    autoOn = $('#tpo-auto').checked;
    runScan();
    clearInterval(tickTimer); tickTimer = setInterval(tick, 1000); tick();
  }
  function stopTPO() { tpoStarted = false; clearTimeout(cycleTimer); cycleTimer = null; clearInterval(tickTimer); tickTimer = null; }

  async function scan() {
    const meta = $('#tpo-meta'), body = $('#tpo-body'), note = $('#tpo-note');
    meta.textContent = 'Scanning NSE…';
    let r; try { r = await api('/api/tpo/scan'); } catch (e) { meta.textContent = 'Scan failed: ' + e.message; return; }
    if (r.error) { meta.textContent = 'Scan error: ' + r.error; return; }
    meta.innerHTML = '';
    const tag = (k, v) => meta.append(el('span', 'tag', `${k} <b>${v}</b>`));
    tag('universe', r.universe);
    if (r.niftyChangePct != null) tag('NIFTY', (r.niftyChangePct >= 0 ? '+' : '') + r.niftyChangePct + '%');
    tag('setups', r.count);
    tag('updated', new Date(r.ts).toLocaleTimeString());
    body.innerHTML = '';
    if (!r.rows.length) {
      body.innerHTML = '<tr><td colspan="10" class="tpo-empty">No high-quality setups right now. Thresholds live in config/markets.json → tpo.</td></tr>';
      note.textContent = r.note || ''; return;
    }
    r.rows.forEach(x => {
      const tr = el('tr');
      tr.innerHTML = `
        <td class="sym">${x.symbol}</td>
        <td class="num">${x.ltp}</td>
        <td><span class="sig ${x.signal}">${x.signal}</span></td>
        <td class="num">${x.entry}</td>
        <td class="num">${x.sl}</td>
        <td class="num">${x.targets.join(' / ')}</td>
        <td class="num rr">${x.rr}</td>
        <td><span class="conf ${x.confidence}">${x.confidence} · ${x.score}</span></td>
        <td class="reason">${x.reason}</td>`;
      const td = el('td'), b = el('button', 'btn-confirm', 'Confirm');
      b.title = 'Load on chart & read live on-chart levels';
      b.addEventListener('click', () => confirm(x.ticker || x.symbol, b));
      td.append(b); tr.append(td); body.append(tr);
    });
    note.textContent = r.note || '';
  }

  async function confirm(symbol, btn) {
    const box = $('#tpo-confirm'); const old = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    box.classList.remove('hidden');
    box.innerHTML = `<h3>Confirming ${symbol} on chart…</h3>`;
    let r;
    try { r = await api('/api/tpo/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol }) }); }
    catch (e) { box.innerHTML = `<h3>${symbol}</h3><div class="prow">Confirm failed: ${e.message}</div>`; btn.disabled = false; btn.textContent = old; return; }
    btn.disabled = false; btn.textContent = old;
    if (!r.ok) { box.innerHTML = `<h3>${symbol}</h3><div class="prow">${r.error || 'failed'}</div>`; return; }
    const L = r.live || {};
    const lines = [
      `chart: ${r.chartSymbol || symbol} · ${r.interval || ''}`,
      `live OHLC: O ${L.open ?? '—'}  H ${L.high ?? '—'}  L ${L.low ?? '—'}  C ${L.close ?? '—'}  (${L.changePct ?? '—'}%)`,
    ];
    (r.profileRows || []).forEach(p => lines.push(p));
    box.innerHTML = `<h3>${r.chartSymbol || symbol} — on-chart confirm</h3>`
      + lines.map(l => `<div class="prow">${l}</div>`).join('')
      + `<div class="hint">${r.note || ''}</div>`;
  }
})();
