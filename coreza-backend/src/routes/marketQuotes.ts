import { Router } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/jwtAuth';

const benchmarks = {
  nasdaq: { symbol: '^IXIC', name: 'NASDAQ Composite', unit: 'points' },
  nyse: { symbol: '^NYA', name: 'NYSE Composite', unit: 'points' },
  bse: { symbol: '^BSESN', name: 'BSE SENSEX', unit: 'points' },
  nse: { symbol: '^NSEI', name: 'NIFTY 50', unit: 'points' },
  crypto: { symbol: 'BTC-USD', name: 'BTC/USD', unit: 'USD' },
} as const;
type Market = keyof typeof benchmarks;
const cache = new Map<Market, { expires: number; value: object }>();
const flights = new Map<Market, Promise<object>>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
async function quote(market: Market): Promise<object> {
  const benchmark = benchmarks[market];
  const cached = cache.get(market);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = flights.get(market);
  if (pending) return pending;
  const flight = (async () => {
    try {
      const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(benchmark.symbol)}`, {
        params: { interval: '1d', range: '1d' }, timeout: 6000,
        headers: { 'User-Agent': 'Coreza dashboard' }, maxContentLength: 1000000,
      });
      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      const previous = meta?.previousClose ?? meta?.chartPreviousClose;
      const timestamp = meta?.regularMarketTime;
      if (!finite(price) || !finite(previous) || previous <= 0 || !finite(timestamp) || timestamp <= 0) throw new Error('Incomplete quote');
      const change = price - previous;
      const value = { market, ...benchmark, available: true, price, change, percent: change / previous * 100,
        asOf: new Date(timestamp * 1000).toISOString(), fetchedAt: new Date().toISOString(),
        period: market === 'crypto' ? 'Provider daily reference' : 'Regular session / last close', source: 'Yahoo Finance' };
      cache.set(market, { expires: Date.now() + 60000, value });
      return value;
    } catch {
      const value = { market, ...benchmark, available: false, source: 'Yahoo Finance' };
      // Negative caching bounds provider calls when a venue/symbol is unavailable.
      cache.set(market, { expires: Date.now() + 60000, value });
      return value;
    }
  })();
  flights.set(market, flight);
  try { return await flight; } finally { if (flights.get(market) === flight) flights.delete(market); }
}
const router = Router();
router.use(requireAuth);
router.get('/benchmarks', async (req, res, next) => {
  try {
    const requested = typeof req.query.markets === 'string' ? [...new Set(req.query.markets.split(','))] : [];
    if (requested.length > 5 || requested.some(id => !Object.prototype.hasOwnProperty.call(benchmarks, id))) {
      res.status(400).json({ error: 'Unsupported markets' }); return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ quotes: await Promise.all(requested.map(id => quote(id as Market))) });
  } catch (error) { next(error); }
});
export default router;
