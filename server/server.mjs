// server/server.mjs — zero-dependency dashboard server (Node built-in http).
// Serves public/ and a small JSON API backed by the reused CDP bridge (lib/tv.mjs).
// ANALYSIS ONLY — no order execution endpoints exist.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile as readFileP } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cdpStatus, attachVisibleChart, readChart, readIndicators, readWatchlist, setSymbol,
} from '../lib/tv.mjs';
import { parseSignals } from '../lib/signals.mjs';
import { scanTPO, clampToCircuit } from '../lib/tpo.mjs';
import { getCircuit } from '../lib/upstox.mjs';
import { summary as journalSummary } from '../lib/journal.mjs';
import { runBacktest } from '../lib/backtest.mjs';
import { buildAnalytics } from '../lib/analytics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 4178);
const PUBLIC = join(ROOT, 'public');

// Optional local TLS (mkcert). Present -> HTTPS so Safari trusts it; absent -> HTTP (unchanged).
let tls = null;
try {
  tls = {
    cert: readFileSync(join(ROOT, 'certs', 'localhost+2.pem')),
    key: readFileSync(join(ROOT, 'certs', 'localhost+2-key.pem')),
  };
} catch { tls = null; }
const DATA = join(ROOT, 'data');
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// minimal .env loader (no dependency)
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
const json = s => { try { return JSON.parse(s); } catch { return {}; } };

// Attach to the visible chart, run fn, always close.
async function withChart(fn) {
  const cl = await attachVisibleChart();
  try { return await fn(cl); } finally { cl.close(); }
}

const routes = {
  'GET /api/status': async () => cdpStatus(),

  'GET /api/config': async () => json(await readFileP(join(ROOT, 'config', 'markets.json'), 'utf8')),

  // One consolidated read for the dashboard poll loop.
  'GET /api/snapshot': async () => {
    const status = await cdpStatus();
    if (!status.up) return { status, chart: null, signals: null, watchlist: [] };
    try {
      return await withChart(async cl => {
        const chart = await readChart(cl);
        const rows = await readIndicators(cl);
        const watchlist = await readWatchlist(cl);
        return { status, chart, signals: parseSignals(rows, chart), watchlist, ts: Date.now() };
      });
    } catch (e) { return { status, chart: null, signals: null, watchlist: [], error: e.message }; }
  },

  // best-effort chart switch (experimental — analysis only; used by the India fast-scan)
  'POST /api/chart/symbol': async (req) => {
    const { symbol } = json(await readBody(req));
    if (!symbol) return { ok: false, error: 'symbol required' };
    return withChart(cl => setSymbol(cl, symbol));
  },

  // TPO Scanner — Stage 1: full-universe, profile-informed structural scan (server-side
  // scanner data; real, typically ~15m delayed). No chart interaction.
  'GET /api/tpo/scan': async () => {
    const cfg = json(await readFileP(join(ROOT, 'config', 'markets.json'), 'utf8'));
    return scanTPO(cfg.tpo?.india || {}, 'india');
  },

  'GET /api/tpo/scan/usa': async () => {
    const cfg = json(await readFileP(join(ROOT, 'config', 'markets.json'), 'utf8'));
    return scanTPO(cfg.tpo?.usa || {}, 'usa');
  },

  // Testing tab — forward-test journal summary (real recorded plans + outcomes).
  'GET /api/test/summary': async () => {
    const cfg = json(await readFileP(join(ROOT, 'config', 'markets.json'), 'utf8'));
    return journalSummary(cfg.testing?.gates);
  },

  // Testing tab — 1-minute Upstox replay of journaled India plans (on demand).
  'POST /api/test/backtest': async () => {
    const cfg = json(await readFileP(join(ROOT, 'config', 'markets.json'), 'utf8'));
    return runBacktest(cfg.testing?.gates);
  },

  // Analytics tab — Monte Carlo + HMM regime + robustness, from real outcomes.
  'GET /api/analytics': async (req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const riskPct = Number(url.searchParams.get('riskPct')) || 1;
    return buildAnalytics({ riskPct });
  },

  // TPO Scanner — Stage 2: on-demand deep confirm for one symbol. Switches the visible
  // chart to it and reads LIVE OHLC (real-time per your TV session) plus any Market
  // Profile / Volume Profile study rows present in the chart legend.
  'POST /api/tpo/confirm': async (req) => {
    const { symbol, plan } = json(await readBody(req));
    if (!symbol) return { ok: false, error: 'symbol required' };
    const want = symbol.split(':').pop().toUpperCase().replace(/\s+/g, '');
    const isNSE = /^NSE:/i.test(symbol);

    // Real NSE circuit from Upstox (India only) — fetched independently of the chart so it
    // still returns even if the chart switch fails. Re-clamps the frozen plan to the TRUE
    // circuit and recomputes R:R; degrades to a note if the token is missing/stale.
    let circuit = null, adjusted = null;
    if (isNSE) {
      const c = await getCircuit(symbol);
      if (c.ok) {
        circuit = { ok: true, source: 'upstox', upper: c.upper, lower: c.lower, ltp: c.ltp };
        if (plan && plan.entry != null && Array.isArray(plan.targets)) {
          const adj = clampToCircuit(plan, c.upper, c.lower, 'upstox');
          adjusted = { entry: adj.entry, sl: adj.sl, targets: adj.targets, rr: adj.rr, capped: adj.circuit.capped };
        }
      } else {
        circuit = { ok: false, reason: c.reason, error: c.error };
      }
    }

    const chartOut = await withChart(async cl => {
      await setSymbol(cl, symbol);
      const chart = await readChart(cl);
      const got = (chart.symbol || '').toUpperCase().replace(/\s+/g, '');
      // Guard: the chart switcher is best-effort. If it didn't actually load the requested
      // symbol, do NOT report another symbol's on-chart data as the confirm.
      if (got !== want) {
        return { ok: false, chartSymbol: chart.symbol,
          error: `Chart switch didn't take (chart shows ${chart.symbol || '—'}). Bring a TradingView chart tab to the front and retry.` };
      }
      const rows = await readIndicators(cl);
      const live = parseSignals(rows, chart);
      const rx = /POC|VAH|VAL|value area|volume profile|market profile|\bTPO\b|\bVP\b/i;
      const profileRows = rows.filter(r => rx.test(r));
      return {
        ok: true, chartSymbol: chart.symbol, interval: chart.intervalShort || chart.interval,
        live: { open: live.open, high: live.high, low: live.low, close: live.close, changePct: live.changePct },
        profileRows,
        note: profileRows.length ? 'Profile study levels read from chart legend.'
          : 'No Market/Volume Profile study on the chart — showing live OHLC only. Add a TPO/Volume Profile study for true POC/VAH/VAL.',
      };
    }).catch(e => ({ ok: false, error: e.message }));

    return { ok: chartOut.ok, symbol, ...chartOut, circuit, adjusted };
  },
};

const handler = async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      const out = await routes[key](req);
      if (out && out.__raw) return send(res, 200, out.__raw, out.__type);
      return send(res, 200, out);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  // static files
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
  });
};

const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
const scheme = tls ? 'https' : 'http';
server.listen(PORT, () => console.log(`Dashboard:  ${scheme}://localhost:${PORT}  (TV_CDP=${process.env.TV_CDP || 'http://127.0.0.1:9222'})`));
