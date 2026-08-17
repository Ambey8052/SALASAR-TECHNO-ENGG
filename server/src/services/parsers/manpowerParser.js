import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { normalizeManpowerLabel, detectShiftLabel } from './categoryAliases.js';
import { findHeaderRowIndexes } from './gridUtils.js';

function buildColumnMap(headerRow, subHeaderRow) {
  const dateColumnIndexes = [];
  headerRow.forEach((cell, c) => {
    if (isPlausibleDateSerial(cell)) dateColumnIndexes.push(c);
  });

  const columnMap = [];
  dateColumnIndexes.forEach((colIdx, i) => {
    const date = serialToDate(headerRow[colIdx]);
    const nextDateColIdx = dateColumnIndexes[i + 1] ?? headerRow.length;
    const span = nextDateColIdx - colIdx;

    if (!subHeaderRow || span <= 1) {
      columnMap.push({ col: colIdx, date, shift: null });
      return;
    }

    let anyShiftFound = false;
    for (let c = colIdx; c < nextDateColIdx; c += 1) {
      const shift = detectShiftLabel(subHeaderRow[c]);
      if (shift) {
        anyShiftFound = true;
        columnMap.push({ col: c, date, shift });
      }
    }
    if (!anyShiftFound) {
      columnMap.push({ col: colIdx, date, shift: null });
    }
  });

  return columnMap;
}

export function parseManpowerSheet(rows) {
  const records = [];
  const warnings = [];

  const headerRowIndexes = findHeaderRowIndexes(rows);
  if (headerRowIndexes.length === 0) {
    warnings.push('No date header rows detected in Manpower sheet.');
    return { records, warnings };
  }

  headerRowIndexes.forEach((headerRowIdx, i) => {
    const headerRow = rows[headerRowIdx];
    const candidateSubHeaderRow = rows[headerRowIdx + 1] || [];
    const subHeaderIsItsOwnHeader = headerRowIndexes.includes(headerRowIdx + 1);
    const subHeaderHasShiftLabels = candidateSubHeaderRow.some((cell) => detectShiftLabel(cell));
    const usesSubHeaderRow = !subHeaderIsItsOwnHeader && subHeaderHasShiftLabels;

    const dataStart = headerRowIdx + (usesSubHeaderRow ? 2 : 1);
    const dataEnd = headerRowIndexes[i + 1] ?? rows.length;
    const columnMap = buildColumnMap(headerRow, usesSubHeaderRow ? candidateSubHeaderRow : null);

    for (let r = dataStart; r < dataEnd; r += 1) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const labelCell = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
      const normalized = normalizeManpowerLabel(labelCell);
      if (!normalized) continue;

      columnMap.forEach(({ col, date, shift }) => {
        const value = row[col];
        if (typeof value !== 'number' || !Number.isInteger(value)) return;

        records.push({
          date,
          businessUnit: normalized.businessUnit,
          category: normalized.category,
          shift,
          count: value,
          rawLabel: labelCell,
        });
      });
    }
  });

  return { records, warnings };
}
