import { connectDb } from './src/config/db.js';
import { getSheetValues } from './src/services/googleSheets.service.js';
import { parseProgressSheet } from './src/services/parsers/productionParser.js';

await connectDb();

const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');

for (const { title, client } of [{ title: 'Adani Progress', client: 'Adani' }, { title: 'L&T MHI Progress', client: 'L&T MHI' }]) {
  const rows = await getSheetValues(title);
  const { records, warnings } = parseProgressSheet(rows, client, title);
  if (warnings.length) console.log(`${title} warnings:`, warnings);

  const cutting = records
    .filter((r) => r.processStage === 'cutting' && r.date >= from && r.date <= to)
    .sort((a, b) => a.date - b.date);

  console.log(`\n${client} Cutting, Aug 2026 (${cutting.length} records):`);
  let sum = 0;
  for (const r of cutting) {
    sum += r.dailyIncrementQty;
    console.log(r.date.toISOString().slice(0, 10), 'cum=', r.cumulativeQty, 'incr=', r.dailyIncrementQty);
  }
  console.log('SUM:', sum);
}

process.exit(0);
