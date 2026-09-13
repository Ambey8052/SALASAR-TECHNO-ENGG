import './helpers/env.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgressSheet } from '../src/services/parsers/productionParser.js';
import { parseDispatchSheet } from '../src/services/parsers/dispatchParser.js';
import { parseManpowerSheet } from '../src/services/parsers/manpowerParser.js';
import { parseSynopsisSheet } from '../src/services/parsers/synopsisParser.js';
import { ProductionRecord } from '../src/models/ProductionRecord.js';
import { progressBlock, dispatchBlock, manpowerBlock, synopsisTable, iso } from './helpers/sheets.js';

const find = (records, isoDay, extra = {}) =>
  records.filter((r) => iso(r.date) === isoDay && Object.entries(extra).every(([k, v]) => r[k] === v));

describe('production parser', () => {
  // DA-01: May–Nov 2025 blocks in the L&T MHI tab are headed "RIL" and duplicate the RIL tab.
  test('a block is recorded under the client its own heading names, not the tab', () => {
    const rows = [
      ...progressBlock('RIL', ['2025-11-28', '2025-11-29', '2025-11-30'], [{ label: 'Final Coat', pairs: [[100, 10], [120, 20], [125, 5]] }]),
      ...progressBlock('MHI', ['2025-12-01', '2025-12-02', '2025-12-03'], [{ label: 'Final Coat', pairs: [[0, 0], [7, 7], [9, 2]] }]),
    ];
    const { records, warnings } = parseProgressSheet(rows, 'L&T MHI', 'L&T MHI Progress');
    assert.deepEqual(new Set(find(records, '2025-11-29').map((r) => r.client)), new Set(['RIL']));
    assert.deepEqual(new Set(find(records, '2025-12-02').map((r) => r.client)), new Set(['L&T MHI']));
    assert.ok(warnings.some((w) => /headed "RIL".*recorded under RIL, not L&T MHI/.test(w)));
  });

  // DA-06: a block's trailing next-month columns collide with the next block's own days.
  test("a block's own month wins over another block's trailing column, and a conflict is reported", () => {
    const rows = [
      ...progressBlock('RIL', ['2026-01-29', '2026-01-30', '2026-01-31', '2026-02-02'], [{ label: 'Cutting', pairs: [[100, 1], [110, 10], [120, 10], [132, 12]] }]),
      ...progressBlock('RIL', ['2026-02-01', '2026-02-02', '2026-02-03'], [{ label: 'Cutting', pairs: [[125, 5], [140, 15], [141, 1]] }]),
    ];
    const { records, warnings } = parseProgressSheet(rows, 'RIL', 'RIL Progress');
    const feb2 = find(records, '2026-02-02');
    assert.equal(feb2.length, 1, 'one record per date + client + stage');
    assert.equal(feb2[0].dailyIncrementQty, 15, "the February block's figure for 2 Feb");
    assert.ok(warnings.some((w) => /2026-02-02 RIL cutting appears in two blocks with different figures/.test(w)));
  });

  test('a trailing column is kept when no block covers that day as its own month', () => {
    const rows = progressBlock('Adani', ['2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01'], [{ label: 'Cutting', pairs: [[10, 1], [11, 1], [12, 1], [15, 3]] }]);
    const { records } = parseProgressSheet(rows, 'Adani', 'Adani Progress');
    assert.equal(find(records, '2026-04-01')[0].dailyIncrementQty, 3);
  });

  test('identical duplicates are not reported as conflicts', () => {
    const rows = [
      ...progressBlock('Adani', ['2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01'], [{ label: 'Cutting', pairs: [[10, 1], [11, 1], [12, 1], [15, 3]] }]),
      ...progressBlock('Adani', ['2026-05-01', '2026-05-02', '2026-05-03'], [{ label: 'Cutting', pairs: [[15, 3], [16, 1], [17, 1]] }]),
    ];
    const { warnings } = parseProgressSheet(rows, 'Adani', 'Adani Progress');
    assert.equal(warnings.length, 0);
  });

  // DA-12: day one of tracking has increment == cumulative and is real.
  test('the suspicious-increment guard spares the first tracked day', () => {
    const rows = progressBlock('Adani', ['2026-03-01', '2026-03-02', '2026-03-03'], [{ label: 'Cutting', pairs: [[120, 120], [130, 10], [140, 10]] }]);
    const { records, warnings } = parseProgressSheet(rows, 'Adani', 'Adani Progress');
    assert.equal(find(records, '2026-03-01')[0].dailyIncrementQty, 120);
    assert.equal(warnings.length, 0);
  });

  test('…and still rejects a mid-series increment that claims the whole running total', () => {
    const rows = progressBlock('Adani', ['2026-03-01', '2026-03-02', '2026-03-03'], [{ label: 'Cutting', pairs: [[4900, 10], [4937, 4937], [4940, 3]] }]);
    const { records, warnings } = parseProgressSheet(rows, 'Adani', 'Adani Progress');
    assert.equal(find(records, '2026-03-02')[0].dailyIncrementQty, 0);
    assert.ok(warnings.some((w) => /Suspicious daily increment/.test(w)));
  });

  test('records carry the cell they were read from', () => {
    const rows = progressBlock('Adani', ['2026-03-01', '2026-03-02', '2026-03-03'], [{ label: 'Cutting', pairs: [[1, 1], [2, 1], [3, 1]] }]);
    const [first] = parseProgressSheet(rows, 'Adani', 'Adani Progress').records;
    assert.equal(first.sourceRowIndex, 3);
    assert.equal(first.sourceCol, 4);
  });

  // The sheet records corrections as negative increments (RIL, June 2025: −87, −95).
  test('a negative increment (a correction) passes schema validation', () => {
    const doc = new ProductionRecord({ date: new Date(), client: 'RIL', processStage: 'welding', cumulativeQty: 502, dailyIncrementQty: -87, sourceTab: 'RIL Progress' });
    assert.equal(doc.validateSync(), undefined);
  });
});

describe('dispatch parser', () => {
  const rows = [
    ...dispatchBlock('HSD - February Month Dispatch Summary (RIL and MHI)', ['2026-02-02', '2026-02-03', '2026-02-04'], [
      ['Reliance (Bridge 1B)', '-', 10, 20],
      ['MHI PROJECT', 5, '12.5', '-'],
      ['Grand Total', 5, 10, 20],
      ['Sub-Total', 5, 10, 20],
    ]),
    ...dispatchBlock('Bhilai - February Month Dispatch Summary (AMNS & Utility Bridge)', ['2026-02-02', '2026-02-03', '2026-02-04'], [
      ['AMNS', 21, '-', '-'],
      ['Utility Bridge ', '-', 8, '-'],
      ['Total', 21, 8, 0],
    ]),
  ];
  const { records, warnings } = parseDispatchSheet(rows, 'Daily Dispatch');

  // DA-05
  test('Bhilai-titled blocks are tagged BU; HSD blocks HSD', () => {
    assert.deepEqual(records.filter((r) => r.businessUnit === 'BU').map((r) => r.qty).sort(), [21, 8]);
    assert.equal(records.filter((r) => r.businessUnit === 'HSD').reduce((s, r) => s + r.qty, 0), 35);
  });

  // DA-14
  test('Grand Total and Sub-Total rows are not counted as projects', () => {
    assert.equal(records.filter((r) => /total/i.test(r.project)).length, 0);
  });

  test('a number typed as text is reported, not silently dropped', () => {
    assert.ok(warnings.some((w) => /"12\.5" is text, not a number/.test(w)));
  });

  test('vehicle plan blocks are skipped as a routine note, not a warning', () => {
    const vehicle = dispatchBlock('HSD - Vehicle Plan', ['2026-02-02', '2026-02-03', '2026-02-04'], [['Adani', 2, 3, 4]]);
    vehicle.splice(2, 1, [null, null, null, 'Vehicle Plan', 'Vehicle Actual']);
    const result = parseDispatchSheet(vehicle, 'Daily Dispatch');
    assert.equal(result.records.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.notes.length, 1);
  });
});

describe('manpower parser', () => {
  const rows = manpowerBlock(['2026-08-29', '2026-08-30', '2026-08-31'], [
    [1, 'HSD Fab. MNP', 10, 5, 4, 11, 6, 2, 12, 7, 8],
    [2, 'HSD Paint MNP', 3, 1, 0, 3, 1, 0, 4, 2, 1],
    // The month-averages table below the daily one: same labels, no Sr. No.
    [null, 'HSD Fab. MNP', 11, 6, 5, 11, 6, 5, 11, 6, 5],
  ]);
  const { records } = parseManpowerSheet(rows);

  // §7.2 rule 1: the last date of a block keeps its Night and 12.30 columns.
  test('the last date of a block keeps Night and 12.30', () => {
    const last = find(records, '2026-08-31', { category: 'fabrication' });
    assert.deepEqual(Object.fromEntries(last.map((r) => [r.shift, r.count])), { day: 12, night: 7, mid: 8 });
  });

  // §7.2 rule 2: a whole-number average must not overwrite a real day.
  test('the unnumbered averages table is not read as daily figures', () => {
    assert.equal(find(records, '2026-08-29', { category: 'fabrication', shift: 'day' })[0].count, 10);
    assert.equal(records.length, 18);
  });

  test('a date listed in two month blocks is reported', () => {
    const twice = [...manpowerBlock(['2026-02-09', '2026-02-10', '2026-03-11'], [[1, 'HSD Fab. MNP', 1, 1, 1, 1, 1, 1, 1, 1, 1]]),
      ...manpowerBlock(['2026-03-10', '2026-03-11', '2026-03-12'], [[1, 'HSD Fab. MNP', 2, 2, 2, 2, 2, 2, 2, 2, 2]])];
    const { warnings } = parseManpowerSheet(twice);
    assert.ok(warnings.some((w) => /2026-03-11 is listed in 2 different month tables/.test(w)));
  });
});

describe('synopsis parser', () => {
  // DA-02 + DA-03 + DA-04 in one January-shaped workbook.
  const rows = synopsisTable(['01.01.26', '02.01.26', '22.06.26', '04.01.26'], [
    ['Ramboll Domestic', 100, 5, 0, 7, null],
    ['Ramboll Export', 50, 3, 4, null, null],
    ['ZETWERK (Job)', 20, 1, null, null, null],
  ], [170, 9, 4, 7, null, 20]);
  const parsed = parseSynopsisSheet(rows, 'Dispach Jan 2026.xlsx');

  test('Ramboll Domestic stays its own department and category', () => {
    const domestic = parsed.departments.find((d) => d.sourceLabel === 'Ramboll Domestic');
    assert.equal(domestic.department, 'Ramboll Domestic');
    assert.equal(domestic.category, 'Ramboll Domestic');
    assert.equal(parsed.departments.find((d) => d.sourceLabel === 'Ramboll Export').department, 'Ramboll Export');
  });

  test('ZETWERK (Job) is job work', () => {
    const z = parsed.departments.find((d) => d.sourceLabel === 'ZETWERK (Job)');
    assert.deepEqual([z.department, z.category, z.mode], ['Job Work (Zetwerk)', 'Job Work', 'Job Work']);
  });

  test('a day column dated outside the month is left out, with its tonnage in the warning', () => {
    assert.equal(parsed.month, '2026-01');
    assert.ok(parsed.daily.every((r) => iso(r.date).startsWith('2026-01')));
    assert.ok(parsed.coveredDates.every((d) => iso(d).startsWith('2026-01')));
    assert.ok(parsed.warnings.some((w) => /"22\.06\.26".*Its 7\.000 MT is left out/.test(w)));
  });

  test('the daily records add up to the department totals', () => {
    const daily = parsed.daily.reduce((s, r) => s + r.qty, 0);
    const departments = parsed.departments.reduce((s, d) => s + d.dispatched, 0);
    assert.equal(daily, departments);
  });

  test('two rows folding onto one key are summed and reported, never dropped', () => {
    const clash = synopsisTable(['01.04.26', '02.04.26', '03.04.26'], [
      ['HSD-Adani', 100, 5, 6, 7],
      ['Adani (HSD)', 10, 1, null, 2],
    ]);
    const result = parseSynopsisSheet(clash, 'april.xlsx');
    const keys = result.daily.map((r) => `${iso(r.date)}|${r.department}|${r.mode}`);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate keys reach the database');
    assert.equal(result.daily.reduce((s, r) => s + r.qty, 0), 21);
    assert.ok(result.warnings.some((w) => /both count as HSD - Adani/.test(w)));
  });
});
