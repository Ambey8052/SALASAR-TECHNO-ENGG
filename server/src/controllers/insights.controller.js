import { buildHsdSummaryData, parseDateRange } from './dashboard.controller.js';
import { generateInsights, InsightsUnavailableError } from '../services/aiInsights.service.js';
import { InsightCache } from '../models/InsightCache.js';

// Cached for a full day, in the database rather than in memory, so every manager who opens
// the dashboard on a given day sees the same analysis and it survives server restarts —
// at most one Gemini call per filter combination per day, instead of one per page load.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(from, to, businessUnit, client) {
  return [from.toISOString(), to.toISOString(), businessUnit || '', client || ''].join('|');
}

export async function getHsdInsights(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, client } = req.query;

  const key = cacheKey(from, to, businessUnit, client);
  const cached = await InsightCache.findOne({ key }).lean();
  if (cached && Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const summary = await buildHsdSummaryData(from, to, businessUnit, client);
    const insights = await generateInsights(summary);
    await InsightCache.findOneAndUpdate(
      { key },
      { key, data: insights, generatedAt: new Date() },
      { upsert: true },
    );
    res.json({ ...insights, cached: false });
  } catch (err) {
    if (err instanceof InsightsUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate insights', detail: err.message });
  }
}
