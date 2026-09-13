import { ManpowerRecord } from '../models/ManpowerRecord.js';
import { ProductionRecord } from '../models/ProductionRecord.js';
import { DispatchRecord } from '../models/DispatchRecord.js';
import { Target } from '../models/Target.js';
import { SyncLog } from '../models/SyncLog.js';
import { roundDeep } from '../utils/roundNumbers.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// The plant works on India Standard Time. Sheet dates are stored as UTC midnight of the IST
// calendar day they name, so "today" has to be that same IST day expressed the same way.
// Computing it from the server's UTC clock showed the previous day's figures as "today" from
// midnight to 05:30 every night.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

function istToday() {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

// Dates arrive as calendar days, "YYYY-MM-DD". Anything else used to reach MongoDB as an
// Invalid Date, which the driver silently turns into 1 Jan 1970 — a nonsense range answered
// with confident-looking numbers.
function parseDay(value, name) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${name} must be a date in YYYY-MM-DD form.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestError(`${name} is not a real calendar date.`);
  }
  return date;
}

function parseDateRange(query) {
  const toDay = parseDay(query.to, 'to') ?? istToday();
  const fromDay = parseDay(query.from, 'from') ?? new Date(toDay.getTime() - 29 * MS_PER_DAY);
  if (fromDay > toDay) throw new BadRequestError('from must not be after to.');
  return { from: fromDay, to: new Date(toDay.getTime() + MS_PER_DAY - 1) };
}

function parseFilters(query) {
  const { businessUnit, client } = query;
  if (businessUnit !== undefined && businessUnit !== 'HSD' && businessUnit !== 'BU') {
    throw new BadRequestError('businessUnit must be HSD or BU.');
  }
  if (client !== undefined && (typeof client !== 'string' || client.length === 0 || client.length > 50)) {
    throw new BadRequestError('client must be a single client name.');
  }
  return { businessUnit, client };
}

function startEndOfToday() {
  const start = istToday();
  return { start, end: new Date(start.getTime() + MS_PER_DAY - 1) };
}

// Day and night are full shifts worked by different people, so both count in full. The 12.30
// column is a half shift and counts as half a head — a day that ran one would otherwise be
// overstated. Records keep the figure exactly as the sheet writes it; the weighting is applied
// here, at the point of totalling, so every record still traces back to its own cell.
//
// Every manpower total on the dashboard must use this rather than summing $count directly, or
// the figures on one chart will disagree with the next.
const weightedHeadcount = () => ({
  $sum: { $multiply: ['$count', { $cond: [{ $eq: ['$shift', 'mid'] }, 0.5, 1] }] },
});

async function getManpowerSummary(from, to, businessUnit) {
  const match = { date: { $gte: from, $lte: to } };
  if (businessUnit) match.businessUnit = businessUnit;

  const { start, end } = startEndOfToday();
  const todayMatch = { date: { $gte: start, $lte: end } };
  if (businessUnit) todayMatch.businessUnit = businessUnit;

  const [byCategory, trend, trendByCategoryRows, todayTotal] = await Promise.all([
    // Average per day, not summed across the range — headcount is a daily snapshot, not
    // a flow, so adding 30 days of counts together would wildly overstate it.
    ManpowerRecord.aggregate([
      { $match: match },
      { $group: { _id: { category: '$category', date: '$date' }, dailyTotal: weightedHeadcount() } },
      { $group: { _id: '$_id.category', total: { $avg: '$dailyTotal' } } },
      { $sort: { total: -1 } },
    ]),
    ManpowerRecord.aggregate([
      { $match: match },
      { $group: { _id: '$date', total: weightedHeadcount() } },
      { $sort: { _id: 1 } },
    ]),
    // Every category broken out day by day, for the manpower trend chart. HSD only ever has
    // fabrication/painting records, so its trend naturally shows just those two lines; Bhilai
    // (BU) also has civil and shed (and office), which show up here the same way.
    ManpowerRecord.aggregate([
      { $match: match },
      { $group: { _id: { date: '$date', category: '$category' }, total: weightedHeadcount() } },
      { $sort: { '_id.date': 1 } },
    ]),
    ManpowerRecord.aggregate([
      { $match: todayMatch },
      { $group: { _id: null, total: weightedHeadcount() } },
    ]),
  ]);

  const trendByCategoryMap = new Map();
  for (const row of trendByCategoryRows) {
    const key = row._id.date.toISOString();
    if (!trendByCategoryMap.has(key)) trendByCategoryMap.set(key, { date: row._id.date });
    trendByCategoryMap.get(key)[row._id.category] = row.total;
  }

  return {
    today: todayTotal[0]?.total ?? 0,
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total })),
    trend: trend.map((t) => ({ date: t._id, total: t.total })),
    trendByCategory: [...trendByCategoryMap.values()].sort((a, b) => a.date - b.date),
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

// Summed from each day's own recorded figure (dailyIncrementQty), not derived from the
// cumulative-total column. A Python-based audit of the raw spreadsheet (cross-checked
// cell-by-cell against every record in MongoDB, ~5,100 records, zero mismatches after
// fixing a parser bug that dropped the last day of every month — see productionParser.js)
// confirmed this field is fully accurate. Summing it directly is also the only approach
// that's safe for L&T MHI and RIL specifically: that same audit found their cumulative
// column genuinely resets partway through their history (someone restarted the running
// total), so any calculation based on cumulative differences quietly breaks for a date
// range that straddles one of those resets, while a straight sum of daily figures does not.
// Same per-stage totals as byStage, but split out per client too, so a stage's bar can be
// colored by how much each client contributed to it.
async function getStageByClient(from, to, client) {
  const match = { date: { $gte: from, $lte: to }, ...(client ? { client } : {}) };
  const rows = await ProductionRecord.aggregate([
    { $match: match },
    { $group: { _id: { stage: '$processStage', client: '$client' }, total: { $sum: '$dailyIncrementQty' } } },
  ]);

  const byStage = new Map();
  for (const row of rows) {
    const stage = row._id.stage;
    if (!byStage.has(stage)) byStage.set(stage, { stage });
    byStage.get(stage)[row._id.client] = row.total;
  }
  return [...byStage.values()];
}

// Final-coat completions per day, split out per client, for the two-(or three-)line
// completions trend chart — same reshape pattern as getStageByClient/getDispatchTrendByClient.
async function getFinalCoatTrendByClient(from, to, client) {
  const match = { date: { $gte: from, $lte: to }, processStage: 'finalCoat', ...(client ? { client } : {}) };
  const rows = await ProductionRecord.aggregate([
    { $match: match },
    { $group: { _id: { date: '$date', client: '$client' }, total: { $sum: '$dailyIncrementQty' } } },
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

async function getProductionSummary(from, to, client) {
  const match = { date: { $gte: from, $lte: to } };
  if (client) match.client = client;
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [byStage, byStageByClient, byClient, trend, trendByClient, completedToday, completedInRange] = await Promise.all([
    ProductionRecord.aggregate([
      { $match: match },
      { $group: { _id: '$processStage', total: { $sum: '$dailyIncrementQty' } } },
    ]),
    getStageByClient(from, to, client),
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
    getFinalCoatTrendByClient(from, to, client),
    sumFinalCoatIncrement(todayStart, todayEnd, client),
    sumFinalCoatIncrement(from, to, client),
  ]);

  return {
    completedToday,
    completedInRange,
    byStage: byStage.map((s) => ({ stage: s._id, total: s.total })),
    byStageByClient,
    byClient: byClient.map((c) => ({ client: c._id, total: c.total })),
    trend: trend.map((t) => ({ date: t._id, total: t.total })),
    trendByClient,
  };
}

// Bhilai's blocks sit inside the same "Daily Dispatch" tab and are tagged by the parser from
// their own titles. Records synced before that tag existed have no businessUnit and were all
// HSD-titled or unlabelled, so "not BU" is what HSD means.
const unitMatch = (businessUnit) => (businessUnit === 'BU' ? { businessUnit: 'BU' } : { businessUnit: { $ne: 'BU' } });

async function sumDispatchQty(start, end, client, businessUnit) {
  const match = { date: { $gte: start, $lte: end }, ...unitMatch(businessUnit), ...(client ? { client } : {}) };
  const [row] = await DispatchRecord.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$qty' } } },
  ]);
  return row?.total ?? 0;
}

// "Today" is frequently 0 simply because the sheet hasn't been updated yet for the current
// calendar day. The last day that actually has dispatch rows (skipping Sundays/off days
// automatically, since those just won't have rows) is a more useful "as of" figure.
async function getLastRecordedDispatch(client, businessUnit) {
  const match = { ...unitMatch(businessUnit), ...(client ? { client } : {}) };
  const [latest] = await DispatchRecord.aggregate([
    { $match: match },
    { $group: { _id: '$date', total: { $sum: '$qty' } } },
    { $sort: { _id: -1 } },
    { $limit: 1 },
  ]);
  return latest ? { date: latest._id, total: latest.total } : { date: null, total: 0 };
}

// Rows with no recognized client (e.g. sheet projects that couldn't be mapped to a
// known client) are grouped under "Other" here rather than dropped, so the client-wise
// daily breakdown still sums to the same total as the plain day-by-day trend.
async function getDispatchTrendByClient(from, to, client, businessUnit) {
  const match = { date: { $gte: from, $lte: to }, ...unitMatch(businessUnit), ...(client ? { client } : {}) };
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

async function getDispatchSummary(from, to, client, businessUnit) {
  const match = { date: { $gte: from, $lte: to }, ...unitMatch(businessUnit), ...(client ? { client } : {}) };

  const [trend, trendByClient, byClient, lastRecordedDay, inRange] = await Promise.all([
    DispatchRecord.aggregate([
      { $match: match },
      { $group: { _id: '$date', total: { $sum: '$qty' } } },
      { $sort: { _id: 1 } },
    ]),
    getDispatchTrendByClient(from, to, client, businessUnit),
    DispatchRecord.aggregate([
      { $match: { ...match, client: { $ne: null } } },
      { $group: { _id: '$client', total: { $sum: '$qty' } } },
      { $sort: { total: -1 } },
    ]),
    getLastRecordedDispatch(client, businessUnit),
    sumDispatchQty(from, to, client, businessUnit),
  ]);

  return {
    lastRecordedDay,
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
  byStageByClient: [],
  byClient: [],
  trend: [],
  trendByClient: [],
};

// Production (Adani/L&T MHI/RIL progress tabs) is an HSD-only source today. Bhilai has no
// production-progress source connected yet and gets an explicit "unavailable" shape rather than
// empty/zeroed data, so the UI can say so plainly. Dispatch is available for both: the Daily
// Dispatch tab carries Bhilai's own blocks (AMNS, Utility Bridge), which used to be summed into
// HSD's figures.
export async function buildHsdSummaryData(from, to, businessUnit, client) {
  const isBhilai = businessUnit === 'BU';

  const [manpower, production, dispatch, targets] = await Promise.all([
    getManpowerSummary(from, to, businessUnit),
    isBhilai ? UNAVAILABLE_PRODUCTION : getProductionSummary(from, to, client),
    getDispatchSummary(from, to, client, businessUnit),
    isBhilai ? [] : getTargetProgress(),
  ]);

  return {
    range: { from, to },
    manpower: roundDeep(manpower),
    production: isBhilai ? production : { available: true, ...roundDeep(production) },
    dispatch: { available: true, ...roundDeep(dispatch) },
    targets: roundDeep(targets),
  };
}

// When the figures were last refreshed from the sheets: the newest sync that wrote anything.
// The dashboard freezes what it loaded for the session, so without this there was nothing on
// screen to say how old the numbers were (RELIABILITY_REPORT UX-01).
export async function latestDataAsOf() {
  const log = await SyncLog.findOne({ status: { $in: ['success', 'partial'] } }).sort({ startedAt: -1 }).select('finishedAt').lean();
  return log?.finishedAt ?? null;
}

export async function getHsdSummary(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit, client } = parseFilters(req.query);
  const [summary, dataAsOf] = await Promise.all([buildHsdSummaryData(from, to, businessUnit, client), latestDataAsOf()]);
  res.json({ ...summary, dataAsOf, generatedAt: new Date() });
}

export { parseDateRange, parseFilters };

export async function listManpowerRecords(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { businessUnit } = parseFilters(req.query);
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;

  const match = { date: { $gte: from, $lte: to } };
  if (businessUnit) match.businessUnit = businessUnit;
  if (category) match.category = category;

  const records = await ManpowerRecord.find(match).sort({ date: 1 }).lean();
  res.json(records);
}
