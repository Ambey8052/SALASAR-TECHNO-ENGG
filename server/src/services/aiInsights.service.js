import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

const MODEL = 'gemini-flash-latest';

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One-sentence summary of the overall plant status for this range.' },
    narrative: {
      type: 'string',
      description:
        'A short 3-5 sentence paragraph, written in plain prose (not bullets), that reports today\'s figures, then how they compare to the selected range and, where the range spans a month or more, how the period is trending month over month. Grounded only in the provided numbers.',
    },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: '1-2 sentences, grounded only in the numbers provided.' },
          severity: { type: 'string', enum: ['good', 'info', 'warning', 'critical'] },
        },
        required: ['title', 'detail', 'severity'],
      },
      minItems: 1,
      maxItems: 6,
    },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 4,
    },
  },
  required: ['headline', 'narrative', 'insights', 'recommendations'],
};

const SYSTEM_INSTRUCTION = `You are a production operations analyst for Salasar's steel fabrication plant, which has two business units: HSD (Heavy Structure Division, builds cell towers, poles, and bridge components under contract for clients like Adani, L&T, and Reliance) and Bhilai.

You will receive a JSON snapshot for ONE business unit covering a specific date range: manpower on site by category, and, where available, production progress by process stage (cutting, fit-up, welding, visual, blasting, final coat) and by client, dispatch quantities, and any manager-set targets.

If production or dispatch has "available": false, that business unit has no data source connected for it yet — do not treat the null/empty fields as zero activity; state plainly that production/dispatch tracking isn't available for this unit rather than implying nothing was produced or shipped.

Identify concrete, numerically-grounded observations: bottlenecks where an early process stage is far ahead of a later one (work-in-progress piling up), clients whose dispatch is falling behind completed production, manpower trends, and progress against target where targets exist.

Rules:
- Every claim must be traceable to a number actually present in the JSON. Never invent or estimate figures not in the data.
- If a section of data is empty, too sparse, or marked unavailable, say that plainly rather than filling in something generic.
- Keep language plain and operational, suitable for a plant manager glancing at a dashboard, not a data scientist.
- Quantities are in MT (metric tons) unless the field is manpower headcount.
- The "today" figures in the JSON are always the real current day, independent of the selected range; the "InRange"/"inRange" figures are totals for whatever range was selected. Use both to write the narrative paragraph: state today's numbers first, then the range totals, then trend direction if the trend arrays show one.`;

let client = null;
function getClient() {
  if (!env.geminiApiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

export class InsightsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsightsUnavailableError';
  }
}

// Below the client's own 75 s request timeout, so a slow model produces a clear 503 rather than
// a request the browser has already abandoned.
const GEMINI_TIMEOUT_MS = 45_000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Gemini did not answer within ${ms / 1000} s.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const SEVERITIES = new Set(['good', 'info', 'warning', 'critical']);

// The response schema is a request to the model, not a guarantee. A reply missing `insights`
// used to be cached for a day and then crashed the dashboard, which calls insights.map() on it.
// Anything that does not match the shape the panel renders is refused, and never cached.
export function assertInsightsShape(data) {
  const ok =
    data && typeof data === 'object' &&
    typeof data.headline === 'string' &&
    typeof data.narrative === 'string' &&
    Array.isArray(data.insights) &&
    data.insights.every((i) => i && typeof i.title === 'string' && typeof i.detail === 'string' && SEVERITIES.has(i.severity)) &&
    Array.isArray(data.recommendations) &&
    data.recommendations.every((r) => typeof r === 'string');
  if (!ok) throw new InsightsUnavailableError('AI response did not match the expected shape.');
  return {
    headline: data.headline,
    narrative: data.narrative,
    insights: data.insights.slice(0, 6).map(({ title, detail, severity }) => ({ title, detail, severity })),
    recommendations: data.recommendations.slice(0, 4),
  };
}

export async function generateInsights(summary) {
  const ai = getClient();
  if (!ai) throw new InsightsUnavailableError('GEMINI_API_KEY is not configured on the server.');

  let response;
  try {
    response = await withTimeout(
      ai.interactions.create({
        model: MODEL,
        system_instruction: SYSTEM_INSTRUCTION,
        input: JSON.stringify(summary),
        store: false,
        response_format: { type: 'text', mime_type: 'application/json', schema: INSIGHTS_SCHEMA },
      }),
      GEMINI_TIMEOUT_MS,
    );
  } catch (err) {
    throw new InsightsUnavailableError(err.message);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new InsightsUnavailableError('AI response was not valid JSON.');
  }
  return assertInsightsShape(parsed);
}
