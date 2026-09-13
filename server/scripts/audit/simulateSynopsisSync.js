// Audit probe (read-only, offline): replays what sync.service.js does to SynopsisDispatchRecord —
// per workbook, deleteMany({ month }) then insertMany under the unique { date, department, mode }
// index — and shows what the database and the API would then report. check:synopsis flags the
// key collisions; this shows their effect on the numbers a manager actually sees.
//
//   node scripts/audit/simulateSynopsisSync.js <folder-of-monthly-xlsx>

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseSynopsisSheet } from '../../src/services/parsers/synopsisParser.js';
import { buildSynopsisPayload } from '../../src/controllers/synopsis.controller.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/audit/simulateSynopsisSync.js <folder>');
  process.exit(2);
}

const parsed = fs
  .readdirSync(dir)
  .filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))
  .map((f) => {
    const wb = XLSX.read(fs.readFileSync(path.join(dir, f)), { type: 'buffer' });
    return parseSynopsisSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: true }), f);
  })
  .filter((p) => p.month);

const months = parsed
  .map((p) => ({
    month: p.month,
    plannedTotal: p.plannedTotal,
    dispatchedTotal: p.departments.reduce((s, d) => s + d.dispatched, 0),
    coveredDates: p.coveredDates,
    departments: p.departments,
    towers: p.towers,
    sourceFile: p.sourceFile,
    warnings: p.warnings,
  }))
  .sort((a, b) => a.month.localeCompare(b.month));

function simulate(order) {
  const db = new Map();
  const rejected = [];
  for (const p of order) {
    for (const [key, r] of [...db]) if (r.month === p.month) db.delete(key);
    for (const r of p.daily) {
      const key = `${r.date.toISOString()}|${r.department}|${r.mode}`;
      if (db.has(key)) rejected.push(r);
      else db.set(key, r);
    }
  }
  return { records: [...db.values()], rejected };
}

const sourceTotal = months.reduce((s, m) => s + m.dispatchedTotal, 0);
let problems = 0;
// Drive does not promise a listing order, so both extremes are shown.
for (const [label, order] of [
  ['oldest month synced first', [...parsed].sort((a, b) => a.month.localeCompare(b.month))],
  ['newest month synced first', [...parsed].sort((a, b) => b.month.localeCompare(a.month))],
]) {
  const { records, rejected } = simulate(order);
  const payload = buildSynopsisPayload(months, records, null);
  const lostMt = rejected.reduce((s, r) => s + r.qty, 0);
  console.log(`\n[${label}] ${rejected.length} row(s) rejected by the unique index, ${lostMt.toFixed(3)} MT never stored`);
  console.log(`  source ${sourceTotal.toFixed(3)} MT | API kpis.dispatched ${payload.kpis.dispatched} | API monthlyTrend sum ${payload.monthlyTrend.reduce((s, m) => s + m.dispatched, 0).toFixed(3)}`);
  for (const m of months) {
    const scoped = buildSynopsisPayload(months, records.filter((r) => r.month === m.month), m.month);
    if (Math.abs(scoped.kpis.dispatched - m.dispatchedTotal) > 0.05) {
      console.log(`  ${m.month}: month view shows ${scoped.kpis.dispatched} MT, source says ${m.dispatchedTotal.toFixed(3)} MT`);
    }
  }
  if (rejected.length) problems += 1;
}

// A month document whose reporting window reaches outside its own month is pulled into (and
// pro-rated into) date ranges it has nothing to do with.
for (const m of months) {
  const stray = m.coveredDates.filter((d) => d.toISOString().slice(0, 7) !== m.month);
  if (stray.length) {
    problems += 1;
    console.log(`\nFAIL  ${m.sourceFile} (${m.month}) has day column(s) dated ${stray.map((d) => d.toISOString().slice(0, 10)).join(', ')} — outside its own month`);
  }
}

process.exit(problems === 0 ? 0 : 1);
