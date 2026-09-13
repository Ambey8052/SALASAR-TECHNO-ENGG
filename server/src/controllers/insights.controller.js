import crypto from 'node:crypto';
import { buildHsdSummaryData, parseDateRange, parseFilters } from './dashboard.controller.js';
import { generateInsights, InsightsUnavailableError } from '../services/aiInsights.service.js';
import { InsightCache } from '../models/InsightCache.js';

// Cached for a full day, in the database rather than in memory, so every manager who opens
// the dashboard on a given day sees the same analysis and it survives server restarts —
// at most one Gemini call per set of figures per day, instead of one per page load.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Keyed on the figures the analysis is written about, not just the filter. Keyed on the filter
// alone, a sync that changed the numbers left the day's narrative quoting the old ones beside
// charts showing the new. Unchanged figures still hit the cache.
function cacheKey(summary) {
  return crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
}

export async function getHsdInsights(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, client } = parseFilters(req.query);

  // The AI is advisory only: it is handed the same deterministic summary the dashboard shows,
  // and nothing it returns is ever written back to production data.
  const summary = await buildHsdSummaryData(from, to, businessUnit, client);
  const key = cacheKey(summary);

  const cached = await InsightCache.findOne({ key }).lean();
  if (cached && Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true, generatedAt: cached.generatedAt });
  }

  try {
    const insights = await generateInsights(summary);
    const generatedAt = new Date();
    await InsightCache.findOneAndUpdate({ key }, { key, data: insights, generatedAt }, { upsert: true });
    res.json({ ...insights, cached: false, generatedAt });
  } catch (err) {
    if (err instanceof InsightsUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[insights] failed:', err.message);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
}
