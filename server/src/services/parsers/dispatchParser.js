import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { findHeaderRowIndexes } from './gridUtils.js';
import { normalizeClient } from './clientAliases.js';

// The sheet's own aggregate lines: "Total", "Grand Total", "Sub-Total", "G. Total". Only the
// first was recognised before, so any of the others would have been counted as a project.
const AGGREGATE_LABEL = /^(grand\s*|sub\s*-?\s*|g\.?\s*)?total\b/i;

// "Daily Dispatch" interleaves blocks titled "HSD - <Month> Dispatch Summary (RIL and MHI)"
// with blocks titled "Bhilai - <Month> Dispatch Summary (AMNS & Utility Bridge)". With no
// notion of business unit, the Bhilai rows were summed into HSD's dispatch (197 MT in the
// 10 Aug 2026 copy; docs/DATA_ACCURACY_REPORT.md DA-05). The title sits in the row directly
// above each block's date header, so it is read from the two rows above; a block with no
// recognisable title stays HSD, as every block was before.
function blockBusinessUnit(rows, headerRowIdx) {
  for (let r = headerRowIdx - 1; r >= Math.max(0, headerRowIdx - 2); r -= 1) {
    const title = (rows[r] || []).filter((cell) => typeof cell === 'string').join(' ');
    if (/bhilai/i.test(title)) return 'BU';
    if (/\bhsd\b/i.test(title)) return 'HSD';
  }
  return 'HSD';
}

export function parseDispatchSheet(rows, sourceTab) {
  const records = [];
  const warnings = [];
  // Routine, expected skips — reported so the log is complete, but not data problems.
  const notes = [];

  const headerRowIndexes = findHeaderRowIndexes(rows);
  if (headerRowIndexes.length === 0) {
    warnings.push(`No date header rows detected in ${sourceTab}.`);
    return { records, warnings, notes };
  }

  headerRowIndexes.forEach((headerRowIdx, i) => {
    const headerRow = rows[headerRowIdx];
    const dataStart = headerRowIdx + 1;
    const dataEnd = headerRowIndexes[i + 1] ?? rows.length;

    // Most blocks put the dispatched quantity (MT) directly under the date. Some blocks
    // instead track "Vehicle Plan" / "Vehicle Actual" counts under the same date columns —
    // a vehicle count, not MT dispatched, and "planned" vehicles for a future date isn't
    // dispatch that happened yet. Detect that layout from its own sub-header row and skip
    // the whole block rather than silently recording vehicle counts as MT.
    const subHeaderRow = rows[dataStart] || [];
    const isVehiclePlanBlock = subHeaderRow.some(
      (cell) => typeof cell === 'string' && /vehicle\s*(plan|actual)/i.test(cell),
    );
    if (isVehiclePlanBlock) {
      notes.push(`Skipped a "Vehicle Plan/Actual" block in ${sourceTab} (row ${headerRowIdx}) — tracks vehicle counts, not dispatched MT.`);
      return;
    }

    const businessUnit = blockBusinessUnit(rows, headerRowIdx);
    const dateColumns = [];
    headerRow.forEach((cell, c) => {
      if (isPlausibleDateSerial(cell)) dateColumns.push({ col: c, date: serialToDate(cell) });
    });

    for (let r = dataStart; r < dataEnd; r += 1) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const projectLabel = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
      if (!projectLabel || AGGREGATE_LABEL.test(projectLabel.trim())) continue;

      const client = normalizeClient(projectLabel);

      dateColumns.forEach(({ col, date }) => {
        const qty = row[col];
        // "-" is the sheet's own "nothing dispatched" mark. A number typed as text ("12.5")
        // is a real figure the sheet shows but the parser cannot safely read, so it is
        // reported instead of vanishing.
        if (typeof qty === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(qty)) {
          warnings.push(`${sourceTab} row ${r} "${projectLabel.trim()}" on ${date.toISOString().slice(0, 10)}: "${qty}" is text, not a number — not counted. Re-enter it as a number.`);
          return;
        }
        if (typeof qty !== 'number' || qty === 0) return;
        if (qty < 0) {
          warnings.push(`${sourceTab} row ${r} "${projectLabel.trim()}" on ${date.toISOString().slice(0, 10)}: negative quantity ${qty} — not counted.`);
          return;
        }

        records.push({
          date,
          businessUnit,
          client,
          project: projectLabel.trim(),
          qty,
          sourceTab,
          sourceRowIndex: r,
        });
      });
    }
  });

  return { records, warnings, notes };
}
