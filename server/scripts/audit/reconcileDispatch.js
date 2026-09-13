// Audit probe (read-only, offline) for the Daily Dispatch parser.
//
//   node scripts/audit/reconcileDispatch.js <path-to-live-workbook.xlsx>
//
// Re-adds every parsed record per sheet row and compares it with the row's own "Total Dispatch"
// cell, and reports tonnage coming from blocks titled "Bhilai" — the parser has no notion of
// business unit, so those rows land in the HSD dispatch totals. Exits non-zero on either.

import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseDispatchSheet } from '../../src/services/parsers/dispatchParser.js';
import { findHeaderRowIndexes } from '../../src/services/parsers/gridUtils.js';
import { isPlausibleDateSerial } from '../../src/utils/sheetDate.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/audit/reconcileDispatch.js <workbook.xlsx>');
  process.exit(2);
}

const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Daily Dispatch'], { header: 1, raw: true, blankrows: false });
const { records, warnings } = parseDispatchSheet(rows, 'Daily Dispatch');
warnings.forEach((w) => console.log(`  WARN  ${w}`));

let problems = 0;
let bhilaiMt = 0;
let rowsOk = 0;
const headers = findHeaderRowIndexes(rows);

headers.forEach((h, i) => {
  let t = h - 1;
  while (t >= 0 && !(rows[t] || []).some((c) => typeof c === 'string' && c.trim().length > 20)) t -= 1;
  const title = (rows[t] || []).find((c) => typeof c === 'string')?.trim() ?? '';
  const end = headers[i + 1] ?? rows.length;
  const blockRecords = records.filter((r) => r.sourceRowIndex > h && r.sourceRowIndex < end);
  const blockMt = blockRecords.reduce((s, r) => s + r.qty, 0);
  // Only a problem if those records are still tagged HSD.
  if (/bhilai/i.test(title)) bhilaiMt += blockRecords.filter((r) => r.businessUnit !== 'BU').reduce((s, r) => s + r.qty, 0);
  console.log(`block at row ${h}: ${/bhilai/i.test(title) ? 'BHILAI' : 'HSD   '} ${blockRecords.length} records, ${blockMt.toFixed(3)} MT  "${title.slice(0, 70)}"`);

  const totalCol = rows[h].findIndex((c) => typeof c === 'string' && /total\s*dispatch/i.test(c));
  for (let r = h + 1; r < end; r += 1) {
    const row = rows[r] || [];
    const label = row.find((c) => typeof c === 'string' && c.trim());
    if (!label || /^total\b/i.test(label.trim())) continue;
    rows[h].forEach((c, ci) => {
      if (isPlausibleDateSerial(c) && typeof row[ci] === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(row[ci])) {
        problems += 1;
        console.log(`  FAIL  row ${r} "${label}": numeric text "${row[ci]}" in a date column is silently ignored`);
      }
    });
    if (totalCol === -1 || typeof row[totalCol] !== 'number') continue;
    const parsed = records.filter((x) => x.sourceRowIndex === r).reduce((s, x) => s + x.qty, 0);
    if (Math.abs(parsed - row[totalCol]) > 0.01) {
      problems += 1;
      console.log(`  FAIL  row ${r} "${label}": parsed ${parsed.toFixed(3)} vs sheet Total Dispatch ${row[totalCol]}`);
    } else {
      rowsOk += 1;
    }
  }
});

console.log(`\n${rowsOk} row(s) agree with their own "Total Dispatch" cell.`);
if (bhilaiMt > 0) {
  problems += 1;
  console.log(`FAIL  ${bhilaiMt.toFixed(3)} MT comes from Bhilai-titled blocks and is counted in the HSD dispatch totals.`);
}
for (const unit of ['HSD', 'BU']) {
  const mt = records.filter((r) => (r.businessUnit ?? 'HSD') === unit).reduce((s, r) => s + r.qty, 0);
  console.log(`${unit} dispatch: ${mt.toFixed(3)} MT`);
}
const unmapped = records.filter((r) => r.client === null);
if (unmapped.length) {
  console.log(`NOTE  ${unmapped.length} record(s) (${unmapped.reduce((s, r) => s + r.qty, 0).toFixed(3)} MT) have no recognised client: ${[...new Set(unmapped.map((r) => r.project))].join(', ')}`);
}
console.log(problems === 0 ? '\nNo problems found.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
