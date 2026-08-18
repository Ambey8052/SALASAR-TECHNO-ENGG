import { ManpowerRecord } from '../models/ManpowerRecord.js';
import { ProductionRecord } from '../models/ProductionRecord.js';
import { DispatchRecord } from '../models/DispatchRecord.js';
import { Target } from '../models/Target.js';
import { roundDeep } from '../utils/roundNumbers.js';

function parseDateRange(query) {
  const to = query.to ? new Date(query.to) : new Date();
  to.setUTCHours(23, 59, 59, 999);

  const from = query.from ? new Date(query.from) : new Date(to);
  if (!query.from) from.setUTCDate(from.getUTCDate() - 29);
  from.setUTCHours(0, 0, 0, 0);

  return { from, to };
}

function startEndOfToday() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

async function getManpowerSummary(from, to, businessUnit) {
  const match = { date: { $gte: from, $lte: to } };
  if (businessUnit) match.businessUnit = businessUnit;

  const { start, end } = startEndOfToday();
  const todayMatch = { date: { $gte: start, $lte: end } };
  if (businessUnit) todayMatch.businessUnit = businessUnit;

  const [byCategory, trend, todayTotal] = await Promise.all([
    // Average per day, not summed across the range — headcount is a daily snapshot, not
    // a flow, so adding 30 days of counts together would wildly overstate it.
    ManpowerRecord.aggregate([
      { $match: match },
      { $group: { _id: { category: '$category', date: '$date' }, dailyTotal: { $sum: '$count' } } },
      { $group: { _id: '$_id.category', total: { $avg: '$dailyTotal' } } },
      { $sort: { total: -1 } },
    ]),
    ManpowerRecord.aggregate([
      { $match: match },
      { $group: { _id: '$date', total: { $sum: '$count' } } },
      { $sort: { _id: 1 } },
    ]),
    ManpowerRecord.aggregate([
      { $match: todayMatch },
      { $group: { _id: null, total: { $sum: '$count' } } },
    ]),
  ]);

  return {
    today: todayTotal[0]?.total ?? 0,
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total })),
    trend: trend.map((t) => ({ date: t._id, total: t.total })),
  };
}

async function sumFinalCoatIncrement(start, end, client) {
  const match = { date: { $gte: start, $lte: end }, processStage: 'finalCoat', ...(client ? { client } : {}) };
  const [row] = await ProductionRecord.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$dailyIncrementQty' } } },
  ]);
  return row?.total ?? 0;
}

async function getLatestFinalCoatByClient() {
  const rows = await ProductionRecord.aggregate([
    { $match: { processStage: 'finalCoat' } },
    { $sort: { date: -1 } },
    { $group: { _id: '$client', cumulativeQty: { $first: '$cumulativeQty' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.cumulativeQty]));
}

async function getProductionSummary(from, to, client) {
  const match = { date: { $gte: from, $lte: to } };
  if (client) match.client = client;
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [byStage, byClient, trend, completedToday, completedInRange] = await Promise.all([
    ProductionRecord.aggregate([
      { $match: match },
      { $group: { _id: '$processStage', total: { $sum: '$dailyIncrementQty' } } },
    ]),
    ProductionRecord.aggregate([
      { $match: { ...match, processStage: 'finalCoat' } },
      { $group: { _id: '$client', total: { $sum: '$dailyIncrementQty' } } },
      { $sort: { total: -1 } },
    ]),
    ProductionRecord.aggregate([
      { $match: { ...match, processStage: 'finalCoat' } },
      { $group: { _id: '$date', total: { $sum: '$dailyIncrementQty' } } },
      { $sort: { _id: 1 } },
    ]),
    sumFinalCoatIncrement(todayStart, todayEnd, client),
    sumFinalCoatIncrement(from, to, client),
  ]);

  return {
    completedToday,
    completedInRange,
    byStage: byStage.map((s) => ({ stage: s._id, total: s.total })),
    byClient: byClient.map((c) => ({ client: c._id, total: c.total })),
    trend: trend.map((t) => ({ date: t._id, total: t.total })),
  };
}

async function sumDispatchQty(start, end, client) {
  const match = { date: { $gte: start, $lte: end }, ...(client ? { client } : {}) };
  const [row] = await DispatchRecord.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$qty' } } },
  ]);
  return row?.total ?? 0;
}

// Rows with no recognized client (e.g. sheet projects that couldn't be mapped to a
// known client) are grouped under "Other" here rather than dropped, so the client-wise
// daily breakdown still sums to the same total as the plain day-by-day trend.
async function getDispatchTrendByClient(from, to, client) {
  const match = { date: { $gte: from, $lte: to }, ...(client ? { client } : {}) };
  const rows = await DispatchRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: { date: '$date', client: { $ifNull: ['$client', 'Other'] } },
        total: { $sum: '$qty' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  const byDate = new Map();
  for (const row of rows) {
    const key = row._id.date.toISOString();
    if (!byDate.has(key)) byDate.set(key, { date: row._id.date });
    byDate.get(key)[row._id.client] = row.total;
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date);
}

async function getDispatchSummary(from, to, client) {
  const match = { date: { $gte: from, $lte: to }, ...(client ? { client } : {}) };
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [trend, trendByClient, byClient, today, inRange] = await Promise.all([
    DispatchRecord.aggregate([
      { $match: match },
      { $group: { _id: '$date', total: { $sum: '$qty' } } },
      { $sort: { _id: 1 } },
    ]),
    getDispatchTrendByClient(from, to, client),
    DispatchRecord.aggregate([
      { $match: { ...match, client: { $ne: null } } },
      { $group: { _id: '$client', total: { $sum: '$qty' } } },
      { $sort: { total: -1 } },
    ]),
    sumDispatchQty(todayStart, todayEnd, client),
    sumDispatchQty(from, to, client),
  ]);

  return {
    today,
    inRange,
    trend: trend.map((t) => ({ date: t._id, total: t.total })),
    trendByClient,
    byClient: byClient.map((c) => ({ client: c._id, total: c.total })),
  };
}

async function getTargetProgress() {
  const [targets, completedMap] = await Promise.all([Target.find().lean(), getLatestFinalCoatByClient()]);
  return targets.map((t) => {
    const completed = completedMap.get(t.client) || 0;
    return { client: t.client, target: t.qty, completed, remaining: Math.max(t.qty - completed, 0) };
  });
}

const UNAVAILABLE_PRODUCTION = {
  available: false,
  completedToday: null,
  completedInRange: null,
  byStage: [],
  byClient: [],
  trend: [],
};

const UNAVAILABLE_DISPATCH = {
  available: false,
  today: null,
  inRange: null,
  trend: [],
  trendByClient: [],
  byClient: [],
};

// Production (Adani/L&T MHI/RIL progress tabs) and dispatch (Daily Dispatch tab) are HSD-only
// data sources today. Bhilai has no production-progress source yet and gets an explicit
// "unavailable" shape rather than empty/zeroed data, so the UI can say so plainly.
export async function buildHsdSummaryData(from, to, businessUnit, client) {
  const isBhilai = businessUnit === 'BU';

  const [manpower, production, dispatch, targets] = await Promise.all([
    getManpowerSummary(from, to, businessUnit),
    isBhilai ? UNAVAILABLE_PRODUCTION : getProductionSummary(from, to, client),
    isBhilai ? UNAVAILABLE_DISPATCH : getDispatchSummary(from, to, client),
    isBhilai ? [] : getTargetProgress(),
  ]);

  return {
    range: { from, to },
    manpower: roundDeep(manpower),
    production: isBhilai ? production : { available: true, ...roundDeep(production) },
    dispatch: isBhilai ? dispatch : { available: true, ...roundDeep(dispatch) },
    targets: roundDeep(targets),
  };
}

export async function getHsdSummary(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, client } = req.query;
  res.json(await buildHsdSummaryData(from, to, businessUnit, client));
}

export { parseDateRange };

export async function listManpowerRecords(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, category } = req.query;

  const match = { date: { $gte: from, $lte: to } };
  if (businessUnit) match.businessUnit = businessUnit;
  if (category) match.category = category;

  const records = await ManpowerRecord.find(match).sort({ date: 1 }).lean();
  res.json(records);
}
