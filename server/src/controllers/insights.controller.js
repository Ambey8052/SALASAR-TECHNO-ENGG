import { buildHsdSummaryData, parseDateRange } from './dashboard.controller.js';
import { generateInsights, InsightsUnavailableError } from '../services/aiInsights.service.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheKey(from, to, businessUnit, client) {
  return [from.toISOString(), to.toISOString(), businessUnit || '', client || ''].join('|');
}

export async function getHsdInsights(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, client } = req.query;

  const key = cacheKey(from, to, businessUnit, client);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const summary = await buildHsdSummaryData(from, to, businessUnit, client);
    const insights = await generateInsights(summary);
    cache.set(key, { at: Date.now(), data: insights });
    res.json({ ...insights, cached: false });
  } catch (err) {
    if (err instanceof InsightsUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate insights', detail: err.message });
  }
}
