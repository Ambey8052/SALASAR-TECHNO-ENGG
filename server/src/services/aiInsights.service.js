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

export async function generateInsights(summary) {
  const ai = getClient();
  if (!ai) throw new InsightsUnavailableError('GEMINI_API_KEY is not configured on the server.');

  let response;
  try {
    response = await ai.interactions.create({
      model: MODEL,
      system_instruction: SYSTEM_INSTRUCTION,
      input: JSON.stringify(summary),
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema: INSIGHTS_SCHEMA },
    });
  } catch (err) {
    throw new InsightsUnavailableError(err.message);
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new InsightsUnavailableError('AI response was not valid JSON.');
  }
}
