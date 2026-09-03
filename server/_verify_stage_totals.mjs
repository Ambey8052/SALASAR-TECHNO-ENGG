import { connectDb } from './src/config/db.js';
import { getSheetValues } from './src/services/googleSheets.service.js';
import { parseProgressSheet } from './src/services/parsers/productionParser.js';
import { ProductionRecord } from './src/models/ProductionRecord.js';

await connectDb();

const PROGRESS_TABS = [
  { title: 'Adani Progress', client: 'Adani' },
  { title: 'L&T MHI Progress', client: 'L&T MHI' },
  { title: 'RIL Progress', client: 'RIL' },
];

const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');
const STAGES = ['cutting', 'fitUp', 'welding', 'visual', 'blasting', 'finalCoat'];

const freshByClientStage = {};
for (const { title, client } of PROGRESS_TABS) {
  const rows = await getSheetValues(title);
  const { records } = parseProgressSheet(rows, client, title);
  const aug = records.filter((r) => r.date >= from && r.date <= to);
  freshByClientStage[client] = {};
  for (const stage of STAGES) {
    freshByClientStage[client][stage] = aug.filter((r) => r.processStage === stage).reduce((s, r) => s + r.dailyIncrementQty, 0);
  }
}

console.log('Fresh parse, Aug 2026, dailyIncrementQty summed per client/stage:');
console.table(freshByClientStage);

const dbAgg = await ProductionRecord.aggregate([
  { $match: { date: { $gte: from, $lte: to } } },
  { $group: { _id: { client: '$client', stage: '$processStage' }, total: { $sum: '$dailyIncrementQty' } } },
]);
const dbByClientStage = {};
for (const row of dbAgg) {
  dbByClientStage[row._id.client] = dbByClientStage[row._id.client] || {};
  dbByClientStage[row._id.client][row._id.stage] = row.total;
}
console.log('\nDB, Aug 2026, grouped:');
console.table(dbByClientStage);

// Also check: does cutting < fitUp for Adani specifically make sense? Print cumulative
// snapshot at start and end of August directly from the raw sheet for Adani cutting/fitUp.
const rows = await getSheetValues('Adani Progress');
const { records } = parseProgressSheet(rows, 'Adani', 'Adani Progress');
for (const stage of ['cutting', 'fitUp']) {
  const stageRecords = records.filter((r) => r.processStage === stage).sort((a, b) => a.date - b.date);
  const aug1 = stageRecords.find((r) => r.date.getTime() === from.getTime());
  const aug31 = stageRecords.find((r) => r.date.getTime() === to.getTime() - (to.getTime() % 86400000) || r.date.toISOString().slice(0,10) === '2026-08-31');
  console.log(`\nAdani ${stage}: Aug1 cumulative=${aug1?.cumulativeQty}, Aug31 cumulative=${aug31?.cumulativeQty}`);
}

process.exit(0);
