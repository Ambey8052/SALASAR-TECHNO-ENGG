// Offline end-to-end check for the Synopsis Dispatch pipeline: reads local copies of the
// monthly workbooks, runs them through the same parser and the same payload builder the API
// uses, and reconciles the result against the figures the spreadsheets compute for
// themselves. No database and no Drive connection needed.
//
//   node scripts/checkSynopsis.js <folder-of-xlsx-files>
//
// Exits non-zero if any figure disagrees with its source, so it can be wired into CI.

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseSynopsisSheet } from '../src/services/parsers/synopsisParser.js';
import { buildSynopsisPayload } from '../src/controllers/synopsis.controller.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/checkSynopsis.js <folder-of-xlsx-files>');
  process.exit(2);
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const mt = (n) => `${n.toFixed(3)} MT`;

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
}

const months = [];
const records = [];

for (const file of fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
  const workbook = XLSX.read(fs.readFileSync(path.join(dir, file)), { type: 'buffer', cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: true,
    blankrows: true,
  });
  const parsed = parseSynopsisSheet(rows, file);
  if (!parsed.month) {
    console.log(`\n${file}: no month resolved — skipped`);
    failures += 1;
    continue;
  }

  const dispatchedTotal = parsed.departments.reduce((sum, d) => sum + d.dispatched, 0);
  console.log(`\n${file}  ->  ${parsed.month}`);
  console.log(`  window     ${iso(parsed.coveredDates[0])} .. ${iso(parsed.coveredDates.at(-1))} (${parsed.coveredDates.length} days)`);
  console.log(`  planned    ${mt(parsed.plannedTotal)}`);
  console.log(`  dispatched ${mt(dispatchedTotal)}  (${((dispatchedTotal / parsed.plannedTotal) * 100).toFixed(1)}% of plan)`);
  console.log(`  rows       ${parsed.departments.length} departments, ${parsed.daily.length} dispatch records, ${parsed.towers.length} tower lines`);

  // Every department's day columns, re-added, against the cumulative the sheet itself shows.
  for (const dept of parsed.departments) {
    if (dept.sheetCumulative != null) {
      check(
        Math.abs(dept.dispatched - dept.sheetCumulative) < 0.02,
        `${parsed.month} ${dept.department} (${dept.mode}): parsed ${mt(dept.dispatched)} vs sheet cumulative ${dept.sheetCumulative}`,
      );
    }
    if (dept.sheetBalance != null && dept.planned != null && dept.sheetCumulative != null) {
      check(
        Math.abs(dept.planned - dept.sheetCumulative - dept.sheetBalance) < 0.02,
        `${parsed.month} ${dept.department}: sheet balance ${dept.sheetBalance} != planned ${dept.planned} - dispatched ${dept.sheetCumulative}`,
      );
    }
    if (dept.sheetAchieved != null && dept.planned > 0 && dept.sheetCumulative != null) {
      check(
        Math.abs(dept.sheetCumulative / dept.planned - dept.sheetAchieved) < 0.0005,
        `${parsed.month} ${dept.department}: sheet achieved ${dept.sheetAchieved} != ${(dept.sheetCumulative / dept.planned).toFixed(6)}`,
      );
    }
    check(dept.category !== 'Other', `${parsed.month}: department "${dept.sourceLabel}" fell through every category rule`);
  }

  // SynopsisDispatchRecord is uniquely keyed on date + department + mode, and a month is
  // written with insertMany, so a collision here would be a hard failure at sync time.
  const seen = new Map();
  for (const record of parsed.daily) {
    const key = `${record.date.toISOString()}|${record.department}|${record.mode}`;
    check(
      !seen.has(key),
      `${parsed.month}: "${seen.get(key)}" and "${record.sourceLabel}" both map to ${record.department} (${record.mode}) on ${iso(record.date)}`,
    );
    seen.set(key, record.sourceLabel);
  }

  parsed.warnings.forEach((w) => console.log(`  NOTE  ${w}`));

  months.push({
    month: parsed.month,
    plannedTotal: parsed.plannedTotal,
    dispatchedTotal,
    coveredDates: parsed.coveredDates,
    departments: parsed.departments,
    towers: parsed.towers,
    sourceFile: file,
    warnings: parsed.warnings,
  });
  records.push(...parsed.daily);
}

months.sort((a, b) => a.month.localeCompare(b.month));

// The payload the API would return, checked for internal consistency.
const all = buildSynopsisPayload(months, records, null);
console.log('\n--- combined payload (all months) ---');
console.log(`  planned ${all.kpis.planned} MT | dispatched ${all.kpis.dispatched} MT | achieved ${all.kpis.achievedPct}%`);
console.log(`  ${all.kpis.coveredDays} reported days, ${all.kpis.activeDays} with dispatches, ${all.kpis.idleDays} idle`);
console.log(`  best day ${iso(all.kpis.bestDay.date)} at ${all.kpis.bestDay.total} MT | average ${all.kpis.avgPerCoveredDay} MT/day`);
console.log(`  categories: ${all.byCategory.map((c) => `${c.category} ${c.share}%`).join(', ')}`);
console.log(`  modes: ${all.byMode.map((m) => `${m.mode} ${m.dispatched} MT`).join(', ')}`);
console.log(`  towers: ${all.towers.length} models, ${all.totals.towerNos} towers, ${all.totals.cipNos} CIP`);

const sheetDispatched = months.reduce((sum, m) => sum + m.dispatchedTotal, 0);
const sheetPlanned = months.reduce((sum, m) => sum + m.plannedTotal, 0);
check(Math.abs(all.kpis.dispatched - sheetDispatched) < 0.05, `payload dispatched ${all.kpis.dispatched} != sum of months ${sheetDispatched.toFixed(3)}`);
check(Math.abs(all.kpis.planned - sheetPlanned) < 0.05, `payload planned ${all.kpis.planned} != sum of months ${sheetPlanned}`);

const categorySum = all.byCategory.reduce((sum, c) => sum + c.dispatched, 0);
check(Math.abs(categorySum - all.kpis.dispatched) < 0.05, `categories sum to ${categorySum}, dispatched is ${all.kpis.dispatched}`);
const departmentSum = all.byDepartment.reduce((sum, d) => sum + d.dispatched, 0);
check(Math.abs(departmentSum - all.kpis.dispatched) < 0.05, `departments sum to ${departmentSum}, dispatched is ${all.kpis.dispatched}`);
const modeSum = all.byMode.reduce((sum, m) => sum + m.dispatched, 0);
check(Math.abs(modeSum - all.kpis.dispatched) < 0.05, `modes sum to ${modeSum}, dispatched is ${all.kpis.dispatched}`);
const dailySum = all.daily.reduce((sum, d) => sum + d.total, 0);
check(Math.abs(dailySum - all.kpis.dispatched) < 0.05, `daily series sums to ${dailySum}, dispatched is ${all.kpis.dispatched}`);
check(
  Math.abs(all.cumulative.at(-1).actual - all.kpis.dispatched) < 0.05,
  `cumulative ends at ${all.cumulative.at(-1).actual}, dispatched is ${all.kpis.dispatched}`,
);
check(all.kpis.activeDays <= all.kpis.coveredDays, 'more active days than reported days');
check(all.daily.every((d, i, arr) => i === 0 || arr[i - 1].date <= d.date), 'daily series is not in date order');

// And each month on its own, since the dashboard requests them one at a time too.
for (const m of months) {
  const scoped = buildSynopsisPayload(months, records.filter((r) => r.month === m.month), m.month);
  console.log(
    `  ${m.month}: ${scoped.kpis.dispatched} / ${scoped.kpis.planned} MT` +
      ` (${scoped.kpis.achievedPct}%), ${scoped.kpis.activeDays}/${scoped.kpis.coveredDays} active days,` +
      ` top department ${scoped.byDepartment[0].department} at ${scoped.byDepartment[0].dispatched} MT`,
  );
  check(
    Math.abs(scoped.kpis.dispatched - m.dispatchedTotal) < 0.05,
    `${m.month}: scoped dispatched ${scoped.kpis.dispatched} != ${m.dispatchedTotal.toFixed(3)}`,
  );
  check(scoped.availableMonths.length === months.length, `${m.month}: month picker lost an entry when scoped`);
  const scopedDaily = scoped.daily.reduce((sum, d) => sum + d.total, 0);
  check(Math.abs(scopedDaily - m.dispatchedTotal) < 0.05, `${m.month}: daily series ${scopedDaily} != ${m.dispatchedTotal.toFixed(3)}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
