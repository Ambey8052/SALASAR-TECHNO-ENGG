import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { findHeaderRowIndexes } from './gridUtils.js';

const CLIENT_PATTERNS = [
  { pattern: /reliance|\bril\b/i, client: 'RIL' },
  { pattern: /\bmhi\b/i, client: 'L&T MHI' },
  { pattern: /adani/i, client: 'Adani' },
  { pattern: /afcons/i, client: 'AFCONS' },
  { pattern: /amns/i, client: 'AMNS' },
];

function normalizeClient(label) {
  if (typeof label !== 'string') return null;
  return CLIENT_PATTERNS.find((p) => p.pattern.test(label))?.client ?? null;
}

export function parseDispatchSheet(rows, sourceTab) {
  const records = [];
  const warnings = [];

  const headerRowIndexes = findHeaderRowIndexes(rows);
  if (headerRowIndexes.length === 0) {
    warnings.push(`No date header rows detected in ${sourceTab}.`);
    return { records, warnings };
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
      warnings.push(`Skipped a "Vehicle Plan/Actual" block in ${sourceTab} (row ${headerRowIdx}) — tracks vehicle counts, not dispatched MT.`);
      return;
    }

    const dateColumns = [];
    headerRow.forEach((cell, c) => {
      if (isPlausibleDateSerial(cell)) dateColumns.push({ col: c, date: serialToDate(cell) });
    });

    for (let r = dataStart; r < dataEnd; r += 1) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const projectLabel = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
      if (!projectLabel || /^total\b/i.test(projectLabel.trim())) continue;

      const client = normalizeClient(projectLabel);

      dateColumns.forEach(({ col, date }) => {
        const qty = row[col];
        if (typeof qty !== 'number' || qty <= 0) return;

        records.push({
          date,
          client,
          project: projectLabel.trim(),
          qty,
          sourceTab,
          sourceRowIndex: r,
        });
      });
    }
  });

  return { records, warnings };
}
