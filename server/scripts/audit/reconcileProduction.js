// Audit probe (read-only, offline) for the production parser — there is no check:production
// script, so nothing verified these tabs before the Sept 2026 audit (docs/DATA_ACCURACY_REPORT.md).
//
//   node scripts/audit/reconcileProduction.js <path-to-live-workbook.xlsx>
//
// For each progress tab it reports:
//   - records that would share one database key (date + client + stage) with different values,
//   - month totals, as stored, against the sheet's own "From 1st to till now" column,
//   - blocks whose own client cell names another client, and whether the parser followed it,
// and across tabs: the same figures recorded under two different clients (a double count).
// Exits non-zero if any of those occur.

import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseProgressSheet } from '../../src/services/parsers/productionParser.js';
import { findHeaderRowIndexes } from '../../src/services/parsers/gridUtils.js';
import { isPlausibleDateSerial, serialToDate } from '../../src/utils/sheetDate.js';
import { normalizeStageLabel } from '../../src/services/parsers/stageAliases.js';

const TABS = [
  { title: 'Adani Progress', client: 'Adani', blockLabel: /adani/i },
  { title: 'L&T MHI Progress', client: 'L&T MHI', blockLabel: /mhi|l\s*&\s*t/i },
  { title: 'RIL Progress', client: 'RIL', blockLabel: /\bril\b|reliance/i },
];

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/audit/reconcileProduction.js <workbook.xlsx>');
  process.exit(2);
}

const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false });
const iso = (d) => d.toISOString().slice(0, 10);
const keyOf = (r) => `${iso(r.date)}|${r.client}|${r.processStage}`;
let problems = 0;
const allRecords = [];

for (const tab of TABS) {
  const name = workbook.SheetNames.find((n) => n.trim() === tab.title);
  if (!name) {
    console.log(`\n${tab.title}: tab not found`);
    problems += 1;
    continue;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, blankrows: false });
  const { records, warnings } = parseProgressSheet(rows, tab.client, tab.title);
  console.log(`\n=== ${tab.title}: ${records.length} parsed records, ${warnings.length} parser warnings`);
  warnings.forEach((w) => console.log(`  WARN  ${w}`));
  allRecords.push(...records);

  // What MongoDB ends up holding: one document per date + client + stage, last write wins.
  const db = new Map();
  const overwrites = [];
  for (const r of records) {
    const prev = db.get(keyOf(r));
    if (prev && (prev.cumulativeQty !== r.cumulativeQty || prev.dailyIncrementQty !== r.dailyIncrementQty)) {
      overwrites.push(`${keyOf(r)}: ${prev.cumulativeQty}/${prev.dailyIncrementQty} overwritten by ${r.cumulativeQty}/${r.dailyIncrementQty}`);
    }
    db.set(keyOf(r), r);
  }
  if (overwrites.length) {
    problems += overwrites.length;
    console.log(`  FAIL  ${overwrites.length} record(s) share a key with different values — one is silently overwritten:`);
    overwrites.slice(0, 10).forEach((o) => console.log(`        ${o}`));
  }

  const dbMonth = {};
  for (const r of db.values()) {
    if (r.client !== tab.client) continue;
    const key = `${iso(r.date).slice(0, 7)}|${r.processStage}`;
    dbMonth[key] = (dbMonth[key] || 0) + r.dailyIncrementQty;
  }

  const headers = findHeaderRowIndexes(rows);
  let matched = 0;
  headers.forEach((h, i) => {
    const header = rows[h];
    const end = headers[i + 1] ?? rows.length;
    const dates = header.filter(isPlausibleDateSerial).map(serialToDate);
    const perMonth = {};
    dates.forEach((d) => {
      perMonth[iso(d).slice(0, 7)] = (perMonth[iso(d).slice(0, 7)] || 0) + 1;
    });
    const month = Object.entries(perMonth).sort((a, b) => b[1] - a[1])[0][0];
    const label = header.find((c) => typeof c === 'string' && !/sl\.?\s*no|from\s*1st/i.test(c)) ?? '';
    if (label && !tab.blockLabel.test(label)) {
      // Fine as long as the parser attributed the block to the client its own heading names.
      const fromBlock = records.filter((x) => x.sourceRowIndex > h && x.sourceRowIndex < end);
      if (fromBlock.some((x) => x.client === tab.client)) {
        problems += 1;
        console.log(`  FAIL  block at row ${h} (${month}) is labelled "${label}" but its figures are recorded as ${tab.client}`);
      } else {
        console.log(`  NOTE  block at row ${h} (${month}) is labelled "${label}" — recorded under that client, not ${tab.client}`);
      }
      return;
    }
    const totalCol = header.findIndex((c) => typeof c === 'string' && /from\s*1st/i.test(c));
    if (totalCol === -1) return;
    for (let r = h + 1; r < end; r += 1) {
      const row = rows[r] || [];
      const stage = normalizeStageLabel(row.find((c) => typeof c === 'string' && c.trim()));
      if (!stage || typeof row[totalCol] !== 'number') continue;
      const stored = dbMonth[`${month}|${stage}`] || 0;
      if (Math.abs(stored - row[totalCol]) <= 0.01) {
        matched += 1;
      } else {
        problems += 1;
        const perDay = typeof row[0] === 'number' ? ` · sheet per-day-avg × days = ${(row[0] * perMonth[month]).toFixed(1)}` : '';
        console.log(`  FAIL  ${month} ${stage}: stored increments ${stored} vs sheet "From 1st" ${row[totalCol]}${perDay}`);
      }
    }
  });
  console.log(`  ${matched} stage-month(s) agree with the sheet's own "From 1st" total`);
}

// The same key from two tabs is harmless when the figures agree (both land on one document) but
// means one tab silently overwrites the other when they do not.
const byKey = new Map();
for (const r of allRecords) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) || []), r]);
const conflicts = [...byKey].filter(
  ([, rs]) => new Set(rs.map((r) => r.sourceTab)).size > 1 &&
    rs.some((r) => r.cumulativeQty !== rs[0].cumulativeQty || r.dailyIncrementQty !== rs[0].dailyIncrementQty),
);
if (conflicts.length) {
  problems += conflicts.length;
  console.log(`\nFAIL  ${conflicts.length} key(s) where two tabs disagree:`);
  conflicts.slice(0, 10).forEach(([key, rs]) => console.log(`        ${key}: ${rs.map((r) => `${r.sourceTab} ${r.cumulativeQty}/${r.dailyIncrementQty}`).join(' vs ')}`));
}

// The same figures under two *different* clients means the same steel is counted twice.
const clientsBySignature = new Map();
for (const r of allRecords) {
  if (r.cumulativeQty <= 0) continue;
  const sig = `${iso(r.date)}|${r.processStage}|${r.cumulativeQty}|${r.dailyIncrementQty}`;
  clientsBySignature.set(sig, new Set([...(clientsBySignature.get(sig) || []), r.client]));
}
const twice = [...clientsBySignature].filter(([, clients]) => clients.size > 1);
if (twice.length) {
  problems += 1;
  const finalCoat = twice.filter(([sig]) => sig.split('|')[1] === 'finalCoat').reduce((s, [sig]) => s + Number(sig.split('|')[3]), 0);
  console.log(`\nFAIL  ${twice.length} records carry identical figures under two different clients; final coat counted twice: ${finalCoat} MT`);
} else {
  console.log('\nNo production is recorded under two different clients.');
}

// Per client, what the dashboard's "completed" (Σ final-coat increments) comes to once the
// database has de-duplicated by key, against the sheet's own latest running total.
const stored = new Map(allRecords.map((r) => [keyOf(r), r]));
for (const client of TABS.map((t) => t.client)) {
  const fc = [...stored.values()].filter((r) => r.client === client && r.processStage === 'finalCoat').sort((a, b) => a.date - b.date);
  const sum = fc.reduce((s, r) => s + r.dailyIncrementQty, 0);
  console.log(`  ${client}: final coat Σ increments ${sum} MT · latest cumulative ${fc.at(-1)?.cumulativeQty ?? '—'}`);
}

console.log(problems === 0 ? '\nNo problems found.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
