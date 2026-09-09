// Parser for the monthly "Dispatch Synopsis" workbooks (one .xlsx per month, sitting in a
// Drive folder of their own — separate from the single live HSD workbook the rest of the
// sync reads).
//
// Each workbook holds up to three independent blocks on one sheet, and their positions move
// from month to month (April puts the department table at the top-left; May pushes it to
// column 7; June onwards adds a "Mode" column and sub-total rows). So nothing here may key
// off fixed row/column numbers — every block is located by the text of its own header row.
//
//   1. Department table  — header has both "Department" and "…Planned…". One row per
//      department, a column per calendar day, then cumulative / balance / achieved-%.
//   2. Category recap    — header has "Department" but no planned column. A re-cut of the
//      same tonnage the department table already carries, so it is deliberately not parsed;
//      the categories are re-derived from department names instead (see CATEGORY_PATTERNS),
//      which yields one consistent grouping across all five months rather than April/May's
//      scheme ("Disp. Excl. Telecom") disagreeing with June's ("Disp. Solar", "Disp. Nepal").
//   3. Tower synopsis    — header has "Tower Model". Physical tower/CIP counts, not tonnage.

const DATE_CELL = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?$/;

// "Total", "TOTAL", "Sub-Total :-", "Grand-Total" — aggregate rows the sheet computes for
// itself. They are read for cross-checking but never counted as departments.
const AGGREGATE_LABELS = new Set(['total', 'subtotal', 'grandtotal']);

const CATEGORY_PATTERNS = [
  { pattern: /job\s*work/i, category: 'Job Work' },
  { pattern: /\bhsd\b/i, category: 'HSD' },
  { pattern: /ramboll/i, category: 'Ramboll Export' },
  { pattern: /indus/i, category: 'Indus GBM' },
  { pattern: /\bcow\b/i, category: 'COW' },
  { pattern: /nepal/i, category: 'Nepal' },
  { pattern: /octapole|transmission/i, category: 'Transmission Pole' },
  { pattern: /solar/i, category: 'Solar' },
];

// The same department is spelled differently month to month ("HSD-L&T-MHI" in June is
// "HSD (Structure) -L&T MHI & RIL" in April). Charts compare departments across months, so
// each label is folded onto one canonical name first. Where a month genuinely tracks a
// combined line that a later month split in two (L&T MHI & RIL), the combined line is kept
// as its own canonical department rather than being forced into one of the split ones —
// merging it would invent a split the sheet never recorded.
const DEPARTMENT_PATTERNS = [
  { pattern: /job\s*work.*galv/i, name: 'Job Work (Galv)' },
  { pattern: /job\s*work.*zetwerk/i, name: 'Job Work (Zetwerk)' },
  { pattern: /job\s*work.*ventura|job\s*work\s+ventura/i, name: 'Job Work (Ventura)' },
  { pattern: /buyout/i, name: 'HSD (Buyout & Others)' },
  { pattern: /hsd.*adani|adani/i, name: 'HSD - Adani' },
  { pattern: /hsd.*mhi.*ril|hsd.*ril.*mhi/i, name: 'HSD - L&T MHI & RIL' },
  { pattern: /hsd.*mhi/i, name: 'HSD - L&T MHI' },
  { pattern: /hsd.*ril/i, name: 'HSD - RIL' },
  { pattern: /ramboll/i, name: 'Ramboll Export' },
  { pattern: /indus/i, name: 'Indus - GBM' },
  { pattern: /octapole/i, name: 'Octapole (Large Pole)' },
  { pattern: /nepal/i, name: 'Nepal Pole' },
  { pattern: /\bcow\b/i, name: 'COW' },
  { pattern: /solar/i, name: 'Solar' },
];

function text(cell) {
  return typeof cell === 'string' ? cell.replace(/\s+/g, ' ').trim() : '';
}

function normalizeLabel(cell) {
  return text(cell).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAggregateRow(label) {
  return AGGREGATE_LABELS.has(normalizeLabel(label));
}

function num(cell) {
  return typeof cell === 'number' && Number.isFinite(cell) ? cell : null;
}

// "01.04.26" -> 2026-04-01T00:00:00Z. Built in UTC to match every other date in this
// codebase (the dashboard's range filters compare against UTC day boundaries).
function parseDateCell(cell) {
  const match = DATE_CELL.exec(text(cell));
  if (!match) return null;
  const [, dd, mm, yy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects an impossible day that Date would otherwise roll forward (31.06 -> 1 July).
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return date;
}

export function canonicalDepartment(label) {
  const clean = text(label);
  if (!clean) return null;
  return DEPARTMENT_PATTERNS.find((d) => d.pattern.test(clean))?.name ?? clean;
}

export function categoryFor(label) {
  const clean = text(label);
  if (!clean) return 'Other';
  return CATEGORY_PATTERNS.find((c) => c.pattern.test(clean))?.category ?? 'Other';
}

// April and May have no "Mode" column at all. Their departments still divide along the same
// three lines June introduced, so the mode is inferred from the department name there rather
// than left blank — which keeps the mode split chart populated for all five months.
function inferMode(label) {
  if (/job\s*work/i.test(label)) return 'Job Work';
  if (/buyout/i.test(label)) return 'Buyout';
  return 'Inhouse';
}

function findColumn(headerRow, pattern) {
  const index = headerRow.findIndex((cell) => pattern.test(text(cell)));
  return index === -1 ? null : index;
}

function locateDepartmentHeader(rows) {
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const hasDepartment = row.some((cell) => /department/i.test(text(cell)));
    const hasPlanned = row.some((cell) => /planned/i.test(text(cell)));
    if (hasDepartment && hasPlanned) return r;
  }
  return null;
}

function parseDepartmentBlock(rows, warnings, sourceFile) {
  const headerRowIndex = locateDepartmentHeader(rows);
  if (headerRowIndex === null) {
    warnings.push(`No department table found in ${sourceFile} (no header row carrying both "Department" and "Planned").`);
    return null;
  }

  const headerRow = rows[headerRowIndex] || [];
  const deptCol = findColumn(headerRow, /department/i);
  const plannedCol = findColumn(headerRow, /planned/i);
  const modeCol = findColumn(headerRow, /^mode$/i);
  const cumulativeCol = findColumn(headerRow, /cumm?ulative|^mtd/i);
  const balanceCol = findColumn(headerRow, /balance/i);
  const achievedCol = findColumn(headerRow, /achiev/i);

  const dateColumns = [];
  headerRow.forEach((cell, c) => {
    const date = parseDateCell(cell);
    if (date) dateColumns.push({ col: c, date });
  });

  if (dateColumns.length === 0) {
    warnings.push(`Department table in ${sourceFile} has no day columns — nothing to record.`);
    return null;
  }

  // The sheet writes its own "Total" / "Sub-Total :-" / "Grand-Total" lines in the Sr. No or
  // Mode column and leaves the Department cell empty, so an aggregate row has to be
  // recognised across the two columns to the left of Department as well. The search stops
  // there rather than scanning the whole row: in May the tower block sits in columns 0-5 of
  // these very same rows, and its own "TOTAL" line would otherwise be mistaken for this
  // table's, silently dropping the department that shares that row.
  const firstDateCol = dateColumns[0].col;
  const labelCols = [deptCol - 2, deptCol - 1, deptCol].filter((c) => c >= 0 && c < firstDateCol);

  const departments = [];
  const daily = [];
  const aggregates = [];
  let currentMode = null;
  let blankRunLength = 0;

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const label = text(row[deptCol]);
    const aggregateLabel = labelCols.map((c) => text(row[c])).find(isAggregateRow) ?? null;

    if (!label && !aggregateLabel) {
      // Two blank department cells in a row means the table has ended. Anything further down
      // belongs to another block (the category recap sits directly below it in April).
      blankRunLength += 1;
      if (blankRunLength >= 2 && departments.length > 0) break;
      continue;
    }
    blankRunLength = 0;

    if (modeCol !== null) {
      const modeCell = text(row[modeCol]);
      // The sheet writes the mode once, on the first row of its group, and leaves the cell
      // empty for the rest — so it carries forward until the next one appears.
      if (modeCell) currentMode = modeCell;
    }

    if (aggregateLabel) {
      aggregates.push({
        label: aggregateLabel,
        rowIndex: r,
        planned: num(row[plannedCol]),
        cumulative: cumulativeCol === null ? null : num(row[cumulativeCol]),
        byDate: dateColumns.map(({ col, date }) => ({ date, qty: num(row[col]) })),
      });
      // "Grand-Total" is the sheet's own last line; nothing below it belongs to this table.
      if (normalizeLabel(aggregateLabel) === 'grandtotal') break;
      continue;
    }

    const department = canonicalDepartment(label);
    const mode = modeCol !== null && currentMode ? currentMode : inferMode(label);
    const planned = num(row[plannedCol]);

    let recordedTotal = 0;
    let recordedDays = 0;
    dateColumns.forEach(({ col, date }) => {
      const qty = num(row[col]);
      // A blank cell is a day the report hasn't reached yet; an explicit 0 is a recorded day
      // with no dispatch. Only the second counts towards the reporting window, and only
      // positive quantities become records — zero-tonnage days are re-derived from the
      // window, so the collection stays a list of actual dispatches.
      if (qty === null) return;
      recordedDays += 1;
      if (qty <= 0) return;
      recordedTotal += qty;
      daily.push({
        date,
        department,
        sourceLabel: label,
        category: categoryFor(label),
        mode,
        qty,
        sourceRowIndex: r,
      });
    });

    departments.push({
      department,
      sourceLabel: label,
      category: categoryFor(label),
      mode,
      planned,
      // Recomputed from the day columns rather than copied from the sheet's own cumulative
      // cell, so every chart and the day-by-day records always agree. The sheet's figures are
      // kept alongside for the accuracy cross-check.
      dispatched: recordedTotal,
      sheetCumulative: cumulativeCol === null ? null : num(row[cumulativeCol]),
      sheetBalance: balanceCol === null ? null : num(row[balanceCol]),
      sheetAchieved: achievedCol === null ? null : num(row[achievedCol]),
      recordedDays,
      sourceRowIndex: r,
    });
  }

  if (departments.length === 0) {
    warnings.push(`Department table in ${sourceFile} had a header but no department rows.`);
    return null;
  }

  // The window the report actually covers: days where at least one department carries a real
  // number. July's header runs to the 30th but its rows stop at the 16th, and treating those
  // empty trailing columns as zero-dispatch days would drag every average down.
  const coveredDates = dateColumns
    .filter(({ col }) => departments.some((d) => num(rows[d.sourceRowIndex]?.[col]) !== null))
    .map(({ date }) => date);

  return { headerRowIndex, departments, daily, aggregates, dateColumns, coveredDates };
}

function parseTowerBlock(rows, warnings, sourceFile) {
  const headerRowIndex = rows.findIndex((row) => (row || []).some((cell) => /tower\s*model/i.test(text(cell))));
  if (headerRowIndex === -1) return [];

  const headerRow = rows[headerRowIndex] || [];
  const modelCol = findColumn(headerRow, /tower\s*model/i);

  // From June onwards this block shares its header row with the department table, which has a
  // "Sr. No." column of its own further left. Every lookup is therefore confined to this
  // block's own columns — searching the full row would pick up the other table's heading.
  const towerColumns = headerRow.map((cell, c) => (c >= modelCol ? cell : null));
  const findTowerColumn = (pattern) => findColumn(towerColumns, pattern);

  // The block's closing "TOTAL" is written in Sr. No, which is always the column immediately
  // left of Tower Model.
  const srNoCol = /^sr\.?\s*no/i.test(text(headerRow[modelCol - 1])) ? modelCol - 1 : null;
  const heightCol = findTowerColumn(/tower\s*ht/i);
  const nosCol = findTowerColumn(/tower\s*nos/i);
  const cipCol = findTowerColumn(/\bcip\b/i);
  const weightCol = findTowerColumn(/^wt\b/i);
  const remarksCol = findTowerColumn(/remark/i);

  const towers = [];
  let blankRunLength = 0;

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const model = text(row[modelCol]);
    if (srNoCol !== null && isAggregateRow(row[srNoCol])) break;

    if (!model) {
      blankRunLength += 1;
      if (blankRunLength >= 2 && towers.length > 0) break;
      continue;
    }
    blankRunLength = 0;
    if (isAggregateRow(model)) break;

    towers.push({
      model,
      // Heights are written as "30/40" or "40/50/60" when one line covers several, so this
      // stays a string rather than being forced to a number.
      heightM: heightCol === null ? null : text(row[heightCol]) || num(row[heightCol])?.toString() || null,
      towerNos: nosCol === null ? null : num(row[nosCol]),
      cipNos: cipCol === null ? null : num(row[cipCol]),
      weightMt: weightCol === null ? null : num(row[weightCol]),
      remarks: remarksCol === null ? null : text(row[remarksCol]) || null,
      sourceRowIndex: r,
    });
  }

  if (towers.length === 0) warnings.push(`Tower synopsis in ${sourceFile} had a header but no rows.`);
  return towers;
}

// The month a workbook reports on, taken from the day columns themselves rather than the
// filename (which is free-form) or the title line (which in several months still carries a
// stale "Till 29.11.24" left over from an older copy of the template).
function resolveMonth(coveredDates, dateColumns) {
  const dates = coveredDates.length > 0 ? coveredDates : dateColumns.map((d) => d.date);
  const counts = new Map();
  for (const date of dates) {
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  return best?.key ?? null;
}

export function parseSynopsisSheet(rows, sourceFile) {
  const warnings = [];
  const block = parseDepartmentBlock(rows, warnings, sourceFile);
  if (!block) return { month: null, departments: [], daily: [], towers: [], warnings };

  const { departments, daily, aggregates, dateColumns, coveredDates } = block;
  const month = resolveMonth(coveredDates, dateColumns);
  const towers = parseTowerBlock(rows, warnings, sourceFile);

  const grandTotal = aggregates.find((a) => normalizeLabel(a.label) === 'grandtotal')
    ?? aggregates.findLast((a) => normalizeLabel(a.label) === 'total')
    ?? null;

  // Guard rail against a future layout change silently dropping or double-counting a row:
  // what was parsed is re-added and compared with the total the sheet computed for itself.
  if (grandTotal?.cumulative != null) {
    const parsedTotal = departments.reduce((sum, d) => sum + d.dispatched, 0);
    if (Math.abs(parsedTotal - grandTotal.cumulative) > 0.5) {
      warnings.push(
        `${sourceFile}: parsed dispatch total ${parsedTotal.toFixed(3)} MT does not match the sheet's own total ${grandTotal.cumulative.toFixed(3)} MT.`,
      );
    }
  }

  // The same comparison day by day. This catches a stray figure in one of the sheet's own
  // total rows that the month-level cumulative check cannot see — June's Buyout total row
  // carries 147.039 MT against 12.06.26 while both of its department rows are zero for that
  // day, which double-counts it up into that day's Grand-Total. The departments are the
  // source of truth here (the sheet's own category recap block agrees with them), so the
  // figures are left as parsed and the discrepancy is reported rather than corrected.
  if (grandTotal) {
    const parsedByDate = new Map();
    for (const record of daily) {
      const key = record.date.toISOString();
      parsedByDate.set(key, (parsedByDate.get(key) || 0) + record.qty);
    }
    for (const { date, qty } of grandTotal.byDate) {
      if (qty == null) continue;
      const parsed = parsedByDate.get(date.toISOString()) || 0;
      if (Math.abs(parsed - qty) > 0.02) {
        warnings.push(
          `${sourceFile}: on ${date.toISOString().slice(0, 10)} the departments add up to ${parsed.toFixed(3)} MT but the sheet's "${grandTotal.label}" row says ${qty.toFixed(3)} MT. Using the departments.`,
        );
      }
    }
  }

  return {
    month,
    sourceFile,
    departments: departments.map(({ sourceRowIndex, ...d }) => ({ ...d, month, sourceFile, sourceRowIndex })),
    daily: daily.map((d) => ({ ...d, month, sourceFile })),
    towers: towers.map((t) => ({ ...t, month, sourceFile })),
    coveredDates,
    plannedTotal: grandTotal?.planned ?? departments.reduce((sum, d) => sum + (d.planned || 0), 0),
    // The sheet's own Total / Sub-Total / Grand-Total lines. Nothing downstream stores these —
    // they exist so the parse can be diffed against the figures the sheet computed for itself.
    aggregates,
    warnings,
  };
}
