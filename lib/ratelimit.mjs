// lib/ratelimit.mjs — ONE process-wide throttle per upstream provider. Zero deps.
//
// WHY THIS IS SHARED, AND WHY THAT MATTERS
// api.upstox.com sits behind Cloudflare. The 429 seen in practice is Cloudflare's
// `error code: 1015` — an IP-level block lasting minutes, not a per-endpoint quota. It
// is triggered by the TOTAL request rate from this machine, so a limiter that only
// covers one module is worthless: four modules here call Upstox, and any one of them can
// get the IP blocked and take the others down with it.
//
//   lib/history.mjs    5 calls per symbol analysed (the three analysis tabs)
//   lib/backtest.mjs   ONE call per journaled India plan — 843 of them in the current
//                      journal. This is the big one: a single "Run India 1-min backtest"
//                      click used to fire 843 requests at 4/sec for 3.5 minutes straight.
//   lib/analytics.mjs  NIFTY daily history for the HMM regime model
//   lib/upstox.mjs     market-quote for the real NSE circuit at TPO Confirm
//
// All four now queue through the same limiter and share one circuit breaker, so the
// machine has a single, bounded request rate towards each provider.
//
// Retrying into a Cloudflare block re-arms it, so a 429 NEVER retries in place: it trips
// the breaker, and while that is open every call fails instantly with the remaining wait
// and sends no traffic at all. Sending nothing is what lets the block expire.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Concurrency cap + minimum spacing + a rolling per-minute ceiling. The per-minute
// ceiling is the one that matters for Cloudflare: spacing alone still permits a long
// sustained burst (a backtest), which is exactly what triggered the block.
function makeLimiter({ concurrency, minGapMs, maxPerMin }) {
  let active = 0, last = 0;
  const recent = [];                 // timestamps within the trailing minute
  const queue = [];
  const pump = () => {
    if (!queue.length || active >= concurrency) return;
    const now = Date.now();
    while (recent.length && now - recent[0] > 60000) recent.shift();
    let wait = Math.max(0, last + minGapMs - now);
    if (maxPerMin && recent.length >= maxPerMin) {
      wait = Math.max(wait, recent[0] + 60000 - now);     // wait for the window to slide
    }
    const job = queue.shift();
    active++;
    setTimeout(async () => {
      last = Date.now(); recent.push(last);
      try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
      finally { active--; pump(); }
    }, wait);
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

// Tunable without a code change — the Cloudflare threshold is empirical, not documented.
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const LIMITS = {
  Upstox: {
    concurrency: 1,
    minGapMs: num(process.env.UPSTOX_MIN_GAP_MS, 600),
    maxPerMin: num(process.env.UPSTOX_MAX_PER_MIN, 60),
  },
  Alpaca: { concurrency: 3, minGapMs: 80, maxPerMin: 180 },
};
const limiters = {};
const limiterFor = p => (limiters[p] ||= makeLimiter(LIMITS[p] || LIMITS.Alpaca));

// ---- circuit breaker (shared across every caller) --------------------------
const breakers = {};        // provider -> { until, strikes }
export function breakerState(provider) {
  const b = breakers[provider];
  if (!b || Date.now() >= b.until) return null;
  return Math.ceil((b.until - Date.now()) / 1000);
}
function trip(provider) {
  const b = breakers[provider] || { strikes: 0 };
  b.strikes = Date.now() < (b.until || 0) ? b.strikes + 1 : 1;
  b.until = Date.now() + Math.min(30000 * 2 ** (b.strikes - 1), 300000);   // 30s → 5m
  breakers[provider] = b;
}
export function resetBreaker(provider) { delete breakers[provider]; }

export class RateLimited extends Error {
  constructor(provider, secs) {
    super(`${provider} is rate limiting this IP (Cloudflare 1015). Paused for ${secs}s — retrying sooner only extends the block.`);
    this.rateLimited = true;
    this.retryInSec = secs;
    this.provider = provider;
  }
}

// The single entry point every Upstox/Alpaca call must use.
// 5xx gets one short retry; 429 trips the breaker and throws RateLimited immediately.
export async function limitedFetch(url, opts, provider = 'Upstox') {
  const open = breakerState(provider);
  if (open) throw new RateLimited(provider, open);
  const limit = limiterFor(provider);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await limit(() => fetch(url, opts));
    if (res.status === 429) { trip(provider); throw new RateLimited(provider, breakerState(provider)); }
    if (res.status < 500 || attempt === 2) return res;
    await sleep(500 + Math.random() * 300);
  }
}

export { LIMITS };
