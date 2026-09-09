// Offline check for the Manpower parser: re-adds every numeric cell in each date block
// straight off the sheet and compares it with what the parser produced for that day. Catches
// a whole shift column being missed, a block being skipped, or a day being counted twice.
//
//   node scripts/checkManpower.js <path-to-workbook.xlsx>
//
// Exits non-zero on any disagreement, so it can be wired into CI.

import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseManpowerSheet } from '../src/services/parsers/manpowerParser.js';
import { isPlausibleDateSerial, serialToDate } from '../src/utils/sheetDate.js';
import { normalizeManpowerLabel, detectShiftLabel } from '../src/services/parsers/categoryAliases.js';

// Mirrors the dashboard's rule: day and night are full shifts, 12.30 is a half shift. Kept in
// step with weightedHeadcount() in dashboard.controller.js.
const shiftWeight = (shift) => (shift === 'mid' ? 0.5 : 1);

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/checkManpower.js <path-to-workbook.xlsx>');
  process.exit(2);
}

const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false });
const sheetName = workbook.SheetNames.find((n) => n.trim() === 'Manpower');
if (!sheetName) {
  console.error('No "Manpower" sheet in that workbook.');
  process.exit(2);
}
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, blankrows: true });

const iso = (d) => d.toISOString().slice(0, 10);
let failures = 0;
const check = (ok, message) => {
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
};

const { records, warnings } = parseManpowerSheet(rows);
warnings.forEach((w) => console.log(`  WARN  ${w}`));

// What the parser made of each day: the raw sum of every cell, and the weighted headcount the
// dashboard actually reports.
const parsedByDate = new Map();
const parsedWeightedByDate = new Map();
for (const record of records) {
  const key = iso(record.date);
  parsedByDate.set(key, (parsedByDate.get(key) || 0) + record.count);
  parsedWeightedByDate.set(key, (parsedWeightedByDate.get(key) || 0) + record.count * shiftWeight(record.shift));
}

// The same days re-added straight from the grid: for every date block, every numeric cell
// between one date column and the next, on rows that name a manpower category.
const sheetByDate = new Map();
const sheetWeightedByDate = new Map();
const headerRowIndexes = [];
rows.forEach((row, r) => {
  if ((row || []).filter(isPlausibleDateSerial).length >= 3) headerRowIndexes.push(r);
});

headerRowIndexes.forEach((headerRowIdx, i) => {
  const headerRow = rows[headerRowIdx];
  const dateCols = [];
  headerRow.forEach((cell, c) => {
    if (isPlausibleDateSerial(cell)) dateCols.push(c);
  });

  const gaps = new Map();
  for (let k = 1; k < dateCols.length; k += 1) {
    const gap = dateCols[k] - dateCols[k - 1];
    gaps.set(gap, (gaps.get(gap) || 0) + 1);
  }
  const stride = [...gaps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;

  const dataEnd = headerRowIndexes[i + 1] ?? rows.length;

  // Which of this block's columns is the 12.30 half shift, read off whichever row below the
  // date row carries the shift labels.
  const shiftRow =
    [headerRowIdx + 1, headerRowIdx + 2]
      .map((idx) => rows[idx])
      .find((row) => row && dateCols.some((c) => detectShiftLabel(row[c]))) ?? null;

  // The daily rows of this block: numbered in the Sr. No column. Rows past the first unnumbered
  // one belong to the month-averages table underneath and are not daily figures. Worked out
  // once per block so the column arithmetic below stays a straight re-add of the grid.
  const srNoCol = headerRow.findIndex((cell) => typeof cell === 'string' && /^s\.?\s*l?r?\.?\s*no/i.test(cell.trim()));
  const dailyRowIdx = [];
  let seenNumbered = false;
  for (let r = headerRowIdx + 1; r < dataEnd; r += 1) {
    const row = rows[r];
    if (!row) continue;
    const label = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
    if (!normalizeManpowerLabel(label)) continue;
    if (srNoCol !== -1) {
      if (typeof row[srNoCol] === 'number') seenNumbered = true;
      else if (seenNumbered) break;
    }
    dailyRowIdx.push(r);
  }

  dateCols.forEach((colIdx, k) => {
    const end = dateCols[k + 1] ?? colIdx + stride;
    const key = iso(serialToDate(headerRow[colIdx]));
    let total = 0;
    let weighted = 0;
    for (const r of dailyRowIdx) {
      const row = rows[r];
      for (let c = colIdx; c < end; c += 1) {
        const v = row[c];
        if (typeof v === 'number' && Number.isInteger(v)) {
          total += v;
          weighted += v * shiftWeight(shiftRow ? detectShiftLabel(shiftRow[c]) : null);
        }
      }
    }
    sheetByDate.set(key, (sheetByDate.get(key) || 0) + total);
    sheetWeightedByDate.set(key, (sheetWeightedByDate.get(key) || 0) + weighted);
  });
});

const days = [...new Set([...parsedByDate.keys(), ...sheetByDate.keys()])].sort();
console.log(`\nManpower: ${records.length} records across ${parsedByDate.size} days (${days[0]} .. ${days[days.length - 1]})`);

let mismatches = 0;
let weightedMismatches = 0;
for (const day of days) {
  const parsed = parsedByDate.get(day) ?? 0;
  const sheet = sheetByDate.get(day) ?? 0;
  if (parsed !== sheet) {
    mismatches += 1;
    failures += 1;
    console.log(`  FAIL  ${day}: parser has ${parsed} people, the sheet's own cells add to ${sheet}`);
  }

  const parsedWeighted = parsedWeightedByDate.get(day) ?? 0;
  const sheetWeighted = sheetWeightedByDate.get(day) ?? 0;
  if (Math.abs(parsedWeighted - sheetWeighted) > 0.001) {
    weightedMismatches += 1;
    failures += 1;
    console.log(`  FAIL  ${day}: weighted headcount ${parsedWeighted} vs the grid's ${sheetWeighted}`);
  }
}
console.log(`  day-by-day vs the raw grid: ${days.length - mismatches}/${days.length} days match`);
console.log(`  weighted headcount (day + night + half of 12.30): ${days.length - weightedMismatches}/${days.length} days match`);

// The weighting has to actually be doing something, or a regression that silently drops it
// would pass every check above.
const withMid = records.filter((r) => r.shift === 'mid' && r.count > 0);
const rawTotal = [...parsedByDate.values()].reduce((s, v) => s + v, 0);
const weightedTotal = [...parsedWeightedByDate.values()].reduce((s, v) => s + v, 0);
check(withMid.length > 0, 'no 12.30 records found at all — the half-shift weighting is untested');
check(
  Math.abs(rawTotal - weightedTotal - withMid.reduce((s, r) => s + r.count, 0) / 2) < 0.001,
  `weighting is off: raw ${rawTotal}, weighted ${weightedTotal}, 12.30 cells ${withMid.reduce((s, r) => s + r.count, 0)}`,
);
console.log(`  raw cell sum ${rawTotal} -> weighted ${weightedTotal} across ${withMid.length} half-shift entries`);

// A day must never carry both a shift-less record and shift-split ones for the same category
// — that is the shape that silently doubles a day's headcount once it reaches the database.
const seen = new Map();
for (const record of records) {
  const key = `${iso(record.date)}|${record.businessUnit}|${record.category}`;
  if (!seen.has(key)) seen.set(key, new Set());
  seen.get(key).add(record.shift);
}
for (const [key, shifts] of seen) {
  check(
    !(shifts.has(null) && shifts.size > 1),
    `${key} has both a shift-less figure and shift-split ones — that day would be counted twice`,
  );
}

// Two records sharing date + unit + category + shift are stored under one key, so the sync
// keeps whichever is written last and the other figure is lost without a trace. It means
// either the same day is listed twice in the sheet, or a summary table is being read as data.
const keyCounts = new Map();
for (const record of records) {
  const key = `${iso(record.date)}|${record.businessUnit}|${record.category}|${record.shift}`;
  keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
}
const duplicateKeys = [...keyCounts.entries()].filter(([, n]) => n > 1);
check(duplicateKeys.length === 0, `${duplicateKeys.length} duplicated record key(s) — one figure per key will be lost on sync`);
duplicateKeys.slice(0, 10).forEach(([key, n]) => console.log(`        ${key} appears ${n} times`));

// The same date landing in two different month blocks means a mistyped date header — the day
// gets one block's figures and some other day gets none.
const datesByBlock = new Map();
headerRowIndexes.forEach((headerRowIdx) => {
  rows[headerRowIdx].forEach((cell) => {
    if (!isPlausibleDateSerial(cell)) return;
    const day = iso(serialToDate(cell));
    if (!datesByBlock.has(day)) datesByBlock.set(day, new Set());
    datesByBlock.get(day).add(headerRowIdx);
  });
});
const crossBlock = [...datesByBlock.entries()].filter(([, blocks]) => blocks.size > 1);
check(crossBlock.length === 0, `${crossBlock.length} date(s) appear in more than one month block — check the sheet's date headers`);
crossBlock.forEach(([day, blocks]) => console.log(`        ${day} appears in blocks at rows ${[...blocks].join(' and ')}`));

const shifts = [...new Set(records.map((r) => r.shift))].map((s) => s ?? 'none');
console.log(`  shifts: ${shifts.join(', ')}`);
console.log(`  groups: ${[...new Set(records.map((r) => `${r.businessUnit}/${r.category}`))].join(', ')}`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
