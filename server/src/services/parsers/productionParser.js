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
  // another date's cumulative column. Deliberately not bounds-checking against
  // headerRow.length here: the parsed sheet trims each row to its own last non-empty cell,
  // and the header row for the *last* date in a block often ends right at that date's own
  // cell (no populated slot after it), even though the data rows below it do have a value
  // one column over. Bounds-checking against the header row's length was wrongly treating
  // that in-range data cell as missing for the final day of every month.
  return dateColumnIndexes.map((col) => {
    const incrementCol = col + 1;
    const hasIncrementCol = !dateColumnIndexes.includes(incrementCol);
    return {
      cumulativeCol: col,
      incrementCol: hasIncrementCol ? incrementCol : null,
      date: serialToDate(headerRow[col]),
    };
  });
}

// A single day's increment claiming to account for almost the entire running cumulative total
// is never real production data mid-month — it's the signature of catching the source sheet in
// a momentary bad state (e.g. synced while someone was mid-edit on that cell). Seen in practice:
// a cumulative of 4937 recorded with dailyIncrementQty also 4937, which would only make sense if
// that were day one of tracking. Guard against it rather than let one bad cell inflate every
// chart and total built from this stage for as long as the sheet happens to hold that value.
const SUSPICIOUS_INCREMENT_RATIO = 0.9;
const SUSPICIOUS_INCREMENT_FLOOR = 50;

function isSuspiciousIncrement(dailyIncrementQty, cumulativeQty) {
  return cumulativeQty >= SUSPICIOUS_INCREMENT_FLOOR && dailyIncrementQty >= cumulativeQty * SUSPICIOUS_INCREMENT_RATIO;
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

        let dailyIncrementQty = incrementCol !== null && typeof row[incrementCol] === 'number'
          ? row[incrementCol]
          : 0;

        if (isSuspiciousIncrement(dailyIncrementQty, cumulativeQty)) {
          warnings.push(
            `Suspicious daily increment for ${client} ${stage} on ${date.toISOString().slice(0, 10)}: ` +
              `increment ${dailyIncrementQty} is implausibly close to the cumulative total ${cumulativeQty} ` +
              `(row ${r}, col ${incrementCol}) — treated as 0 rather than trusted.`,
          );
          dailyIncrementQty = 0;
        }

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
