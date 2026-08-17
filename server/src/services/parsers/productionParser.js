import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { normalizeStageLabel } from './stageAliases.js';
import { findHeaderRowIndexes } from './gridUtils.js';

function buildDateColumnPairs(headerRow) {
  const dateColumnIndexes = [];
  headerRow.forEach((cell, c) => {
    if (isPlausibleDateSerial(cell)) dateColumnIndexes.push(c);
  });

  // Each date occupies two columns: a running (cumulative) total, then that day's own
  // increment. Only the cumulative column carries the date value in the header row, so the
  // increment column is inferred as "the next column over", unless that column is itself
  // another date's cumulative column.
  return dateColumnIndexes.map((col) => {
    const incrementCol = col + 1;
    const hasIncrementCol = incrementCol < headerRow.length && !dateColumnIndexes.includes(incrementCol);
    return {
      cumulativeCol: col,
      incrementCol: hasIncrementCol ? incrementCol : null,
      date: serialToDate(headerRow[col]),
    };
  });
}

export function parseProgressSheet(rows, client, sourceTab) {
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
    const datePairs = buildDateColumnPairs(headerRow);

    for (let r = dataStart; r < dataEnd; r += 1) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const labelCell = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
      const stage = normalizeStageLabel(labelCell);
      if (!stage) continue;

      datePairs.forEach(({ cumulativeCol, incrementCol, date }) => {
        const cumulativeQty = row[cumulativeCol];
        if (typeof cumulativeQty !== 'number') return;

        const dailyIncrementQty = incrementCol !== null && typeof row[incrementCol] === 'number'
          ? row[incrementCol]
          : 0;

        records.push({
          date,
          client,
          processStage: stage,
          cumulativeQty,
          dailyIncrementQty,
          sourceTab,
        });
      });
    }
  });

  return { records, warnings };
}
