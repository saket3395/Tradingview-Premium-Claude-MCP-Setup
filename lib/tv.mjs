#!/usr/bin/env node
// lib/tv.mjs — TradingView Desktop control via Chrome DevTools Protocol. ANALYSIS ONLY.
// Reused, verified bridge (see ../README.md). No order execution.
// Importable as a module by the dashboard server; also runnable as a CLI:
//   node lib/tv.mjs chart|indicators|watchlist|status|pine:read|pine:write <f>|pine:compile|eval <js>
//
// Env: TV_CDP (default http://127.0.0.1:9222), TV_NO_ACTIVATE=1 to skip frontmost activation.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const BASE = process.env.TV_CDP || 'http://127.0.0.1:9222';
const PINE = '[data-name="pine-dialog"]';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').replace(/\s+/g, '');

export function activateTV() {
  if (process.env.TV_NO_ACTIVATE) return;
  try { execSync(`osascript -e 'tell application "TradingView" to activate'`); } catch {}
}

export async function targets() {
  const r = await fetch(`${BASE}/json`).catch(() => null);
  if (!r) throw new Error(`Cannot reach CDP at ${BASE}. Launch TradingView with --remote-debugging-port (npm run tv:debug).`);
  return r.json();
}

// Health probe for the MCP/CDP status panel. Never throws.
export async function cdpStatus() {
  try {
    const v = await (await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(2500) })).json();
    const all = await (await fetch(`${BASE}/json`)).json();
    const charts = all.filter(t => t.type === 'page' && /\/chart\//.test(t.url || ''));
    return {
      up: true,
      endpoint: BASE,
      app: (v['User-Agent'] || '').match(/TVDesktop\/[0-9.]+/)?.[0] || null,
      browser: v.Browser || null,
      chartTabs: charts.length,
      charts: charts.map(c => c.url),
    };
  } catch {
    return { up: false, endpoint: BASE, app: null, chartTabs: 0, charts: [] };
  }
}

// Read the logged-in TradingView session cookie from the running Desktop app via
// CDP (browser-level Storage.getCookies). Returns a "name=value; ..." Cookie header
// string for authenticated data requests, or '' if unavailable. Cached ~60s (the
// cookie rotates rarely) so callers can invoke it freely without hammering CDP.
// Never throws — degrades to '' so callers fall back to anonymous/delayed access.
let _cookieCache = { ts: 0, val: '' };
export async function getSessionCookie(maxAgeMs = 60000) {
  if (Date.now() - _cookieCache.ts < maxAgeMs) return _cookieCache.val;
  try {
    const v = await (await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(2500) })).json();
    if (!v.webSocketDebuggerUrl) return _cookieCache.val;
    const t = connect(v.webSocketDebuggerUrl);
    await t.ready;
    const res = await t.send('Storage.getCookies', {});
    t.close();
    const want = ['sessionid', 'sessionid_sign', 'device_t'];
    const hdr = (res.cookies || [])
      .filter(c => want.includes(c.name) && /tradingview/i.test(c.domain))
      .map(c => `${c.name}=${c.value}`).join('; ');
    _cookieCache = { ts: Date.now(), val: hdr };
    return hdr;
  } catch { return _cookieCache.val; }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect failed')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => { const _id = ++id; ws.send(JSON.stringify({ id: _id, method, params })); return new Promise((res, rej) => pend.set(_id, { res, rej })); };
  return { ready, send, close: () => ws.close() };
}

// Attach to the chart tab the user is actually viewing (visibilityState === 'visible').
export async function attachVisibleChart() {
  const all = await targets();
  const charts = all.filter(t => t.type === 'page' && /\/chart\//.test(t.url || ''));
  if (!charts.length) throw new Error('No TradingView chart tab found.');
  for (const c of charts) {
    const t = connect(c.webSocketDebuggerUrl); await t.ready; await t.send('Runtime.enable');
    const v = await t.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
    t.close();
    if (v.result.value === 'visible') return openClient(c);
  }
  process.stderr.write('warn: no visible chart tab; using first chart. Bring a chart tab to the front for Pine edits.\n');
  return openClient(charts[0]);
}

async function openClient(target) {
  const cl = connect(target.webSocketDebuggerUrl);
  await cl.ready;
  await cl.send('Runtime.enable');
  await cl.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cl.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  cl.target = target;
  return cl;
}

export async function ev(cl, expr) {
  const r = await cl.send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function key(cl, k, code, vk, mods = 0) {
  const b = { modifiers: mods, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cl.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...b });
  await cl.send('Input.dispatchKeyEvent', { type: 'keyUp', ...b });
}

// ---- chart / indicators -------------------------------------------------
export async function readChart(cl) {
  return ev(cl, `
    const t = s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
    return {
      symbol: t('#header-toolbar-symbol-search'),
      interval: (document.querySelector('#header-toolbar-intervals button[aria-label]')||{}).getAttribute?.('aria-label'),
      intervalShort: (document.querySelector('#header-toolbar-intervals [class*="value-"]')||{}).textContent || null,
      url: location.href
    };`);
}
export async function readIndicators(cl) {
  return ev(cl, `return [...document.querySelectorAll('[class*="legend-"][class*="chart-gui-wrapper__legend"]')]
    .map(w => w.textContent.trim().replace(/\\s+/g,' ')).filter(Boolean);`);
}
export async function readWatchlist(cl) {
  return ev(cl, `return [...document.querySelectorAll('[data-name="watchlist-symbol"], [class*="symbol-"][class*="watchlist" i], [data-symbol-full]')]
    .map(e => e.getAttribute('data-symbol-full') || e.textContent.trim()).filter(Boolean).slice(0,300);`);
}

// ---- chart actions (best-effort; analysis only) -------------------------
// Switch the active chart symbol via the symbol-search dialog.
export async function setSymbol(cl, symbol) {
  await ev(cl, `document.querySelector('#header-toolbar-symbol-search')?.click(); return 1;`);
  await sleep(700);
  const typed = await ev(cl, `const i=[...document.querySelectorAll('input')].find(e=>e.offsetParent && /search/i.test((e.getAttribute('data-role')||'')+(e.placeholder||'')+(e.className||''))) || document.querySelector('[data-name="symbol-search-items-dialog"] input');
    if(!i) return false; i.focus(); i.value=''; return true;`);
  if (typed) { for (const ch of symbol.toUpperCase()) await key(cl, ch.toLowerCase(), 'Key' + ch.toUpperCase(), ch.charCodeAt(0)); await sleep(900); await key(cl, 'Enter', 'Enter', 13); await sleep(900); }
  return { ok: typed, symbol: (await readChart(cl)).symbol };
}

// ---- pine editor --------------------------------------------------------
export async function ensurePineOpen(cl) {
  const open = await ev(cl, `return !!document.querySelector('${PINE}')`);
  if (!open) { await ev(cl, `document.querySelector('[data-name="pine-dialog-button"]')?.click(); return 1;`); await sleep(1800); }
  if (!(await ev(cl, `return !!document.querySelector('${PINE}')`))) throw new Error('Could not open Pine editor.');
}
export async function focusMonaco(cl) {
  return ev(cl, `const ta = document.querySelector('${PINE} textarea.inputarea') || document.querySelector('${PINE} textarea');
    if (!ta) return false; ta.focus();
    return document.querySelector('${PINE} .monaco-editor').classList.contains('focused');`);
}
export async function readPine(cl) {
  return ev(cl, `const ls=[...document.querySelectorAll('${PINE} .view-line')].map(l=>({t:parseFloat(l.style.top)||0,x:l.textContent}));
    ls.sort((a,b)=>a.t-b.t); return ls.map(l=>l.x).join('\\n');`);
}
async function errorMarkers(cl) {
  return ev(cl, `return document.querySelector('${PINE}')?.querySelectorAll('.squiggly-error').length ?? -1;`);
}
async function pineConsole(cl) {
  return ev(cl, `return document.querySelector('${PINE} [class*="consoleWrapper" i]')?.textContent.trim().replace(/\\s+/g,' ') || '';`);
}
export async function writePine(cl, code) {
  await ensurePineOpen(cl);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const focused = await focusMonaco(cl); await sleep(120);
    await key(cl, 'a', 'KeyA', 65, 4); await sleep(120);          // Cmd+A select all
    await cl.send('Input.insertText', { text: code }); await sleep(900);
    if (norm(await readPine(cl)) === norm(code)) return { ok: true, attempt, focused };
    if (attempt === 4) return { ok: false, got: await readPine(cl), focused };
    await sleep(400);
  }
}
export async function compilePine(cl) {
  const before = await pineConsole(cl);
  await ev(cl, `document.querySelector('[data-qa-id="add-script-to-chart"]')?.click(); return 1;`);
  for (let i = 0; i < 12; i++) { await sleep(500); if ((await pineConsole(cl)) !== before) break; }
  await sleep(500);
  const full = await pineConsole(cl);
  const lines = full.split(/(?=\d{1,2}:\d{2}:\d{2}\s*[AP]M)/).map(s => s.trim()).filter(Boolean);
  const last = lines.map(l => /Compiling\.\.\./i.test(l)).lastIndexOf(true);
  const thisRun = last >= 0 ? lines.slice(last) : lines.slice(-3);
  const markers = await errorMarkers(cl);
  const errorLine = thisRun.find(l => /\berror\b|cannot|expecting|undeclared|mismatch|undefined/i.test(l)) || null;
  return { ok: markers === 0 && !errorLine, errorMarkers: markers, recent: thisRun, error: errorLine };
}

// ---- CLI (only when run directly) ---------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  (async () => {
    const [cmd, ...args] = process.argv.slice(2);
    if (!cmd) { console.log('cmds: chart | indicators | watchlist | status | pine:read | pine:write <file> | pine:compile | eval <js>'); return; }
    if (cmd === 'status') { console.log(JSON.stringify(await cdpStatus(), null, 2)); return; }
    activateTV(); await sleep(1100);
    const cl = await attachVisibleChart();
    try {
      switch (cmd) {
        case 'chart':       console.log(JSON.stringify(await readChart(cl), null, 2)); break;
        case 'indicators':  (await readIndicators(cl)).forEach(r => console.log(r)); break;
        case 'watchlist':   (await readWatchlist(cl)).forEach(r => console.log(r)); break;
        case 'pine:read':   await ensurePineOpen(cl); console.log(await readPine(cl)); break;
        case 'pine:write':  if (!args[0]) throw new Error('usage: pine:write <file>'); console.log(JSON.stringify(await writePine(cl, readFileSync(args[0], 'utf8').replace(/\n$/, '')))); break;
        case 'pine:compile':await ensurePineOpen(cl); console.log(JSON.stringify(await compilePine(cl), null, 2)); break;
        case 'eval':        if (!args[0]) throw new Error('usage: eval <js>'); console.log(JSON.stringify(await ev(cl, `return (${args[0]})`), null, 2)); break;
        default:            console.log('unknown command:', cmd);
      }
    } finally { cl.close(); }
  })().catch(e => { console.error('ERR:', e.message); process.exit(1); });
}
