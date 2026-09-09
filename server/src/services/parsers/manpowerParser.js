import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { normalizeManpowerLabel, detectShiftLabel } from './categoryAliases.js';
import { findHeaderRowIndexes } from './gridUtils.js';

function getDateColumnIndexes(headerRow) {
  const dateColumnIndexes = [];
  headerRow.forEach((cell, c) => {
    if (isPlausibleDateSerial(cell)) dateColumnIndexes.push(c);
  });
  return dateColumnIndexes;
}

// A candidate sub-header row only counts as the real shift row if it carries shift labels
// within the date columns themselves. This deliberately skips column 0/1, since a weekday
// row (e.g. "Sat","Sun",...) has its own leading row-label "Day" (part of a vertical
// Date/Day/Manpower label stack) that would otherwise false-positive as a "day" shift.
function rowHasShiftLabelsInDateColumns(row, dateColumnIndexes) {
  if (!row || dateColumnIndexes.length === 0) return false;
  const start = dateColumnIndexes[0];
  for (let c = start; c < row.length; c += 1) {
    if (detectShiftLabel(row[c])) return true;
  }
  return false;
}

// How many columns each date occupies, taken as the most common gap between consecutive date
// columns in this block — 3 where the sheet tracks Day / Night / 12.30, 1 where it records a
// single figure per day.
function detectColumnStride(dateColumnIndexes) {
  if (dateColumnIndexes.length < 2) return null;
  const counts = new Map();
  for (let i = 1; i < dateColumnIndexes.length; i += 1) {
    const gap = dateColumnIndexes[i] - dateColumnIndexes[i - 1];
    counts.set(gap, (counts.get(gap) || 0) + 1);
  }
  let best = null;
  for (const [gap, count] of counts) {
    if (!best || count > best.count) best = { gap, count };
  }
  return best?.gap ?? null;
}

function buildColumnMap(headerRow, dateColumnIndexes, subHeaderRow) {
  const columnMap = [];
  // Every date but the last is bounded by the next date column. The last one has no next date,
  // and the header row's own length measures nothing useful there — the date row *ends* at
  // that cell, while its Night and 12.30 headers sit in the sub-header row below it. Falling
  // back to headerRow.length therefore gave the final date a span of 1, so the last day of
  // every month was read as a single un-shifted figure and its night and 12.30 counts were
  // dropped (31 Aug 2026 came out as 221 people against the sheet's 263). The block's own
  // column stride is the correct bound.
  const stride = detectColumnStride(dateColumnIndexes);

  dateColumnIndexes.forEach((colIdx, i) => {
    const date = serialToDate(headerRow[colIdx]);
    const nextDateColIdx = dateColumnIndexes[i + 1] ?? colIdx + (stride ?? Math.max(headerRow.length - colIdx, 1));
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
    const dateColumnIndexes = getDateColumnIndexes(headerRow);

    // The date header can be followed by an optional weekday-label row ("Sat","Sun",...)
    // before the real shift sub-header row ("Day","Night", and a numeric time-serial for
    // "12.30"). Try the row right after the header first; if it doesn't actually carry
    // shift labels within the date columns, try the row after that.
    let subHeaderRowIdx = null;
    for (const candidateIdx of [headerRowIdx + 1, headerRowIdx + 2]) {
      if (headerRowIndexes.includes(candidateIdx)) break;
      if (rowHasShiftLabelsInDateColumns(rows[candidateIdx], dateColumnIndexes)) {
        subHeaderRowIdx = candidateIdx;
        break;
      }
    }

    const dataStart = (subHeaderRowIdx ?? headerRowIdx) + 1;
    const dataEnd = headerRowIndexes[i + 1] ?? rows.length;
    const columnMap = buildColumnMap(headerRow, dateColumnIndexes, subHeaderRowIdx !== null ? rows[subHeaderRowIdx] : null);

    // Most months carry a second, smaller table below the daily one holding that month's
    // AVERAGES per shift — the same "HSD Fab.MNP." labels, but figures like 132.6 and 23.7666
    // instead of a day's headcount. Left alone, those averages are mapped onto the first few
    // dates of the month as though they were daily counts, and land on the same record key as
    // the real day, so whichever is written last wins. Most are filtered out for being
    // fractional, but an average that happens to come out whole (a flat 11, or a 0) slips
    // through and silently replaces a real day's figure.
    //
    // The two tables are told apart by the Sr. No column: every daily row is numbered, the
    // summary rows are not. A block that numbers nothing is left as-is rather than discarded.
    const srNoCol = headerRow.findIndex((cell) => typeof cell === 'string' && /^s\.?\s*l?r?\.?\s*no/i.test(cell.trim()));
    let seenNumberedRow = false;

    for (let r = dataStart; r < dataEnd; r += 1) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const labelCell = row.find((cell) => typeof cell === 'string' && cell.trim().length > 0);
      const normalized = normalizeManpowerLabel(labelCell);
      if (!normalized) continue;

      if (srNoCol !== -1) {
        const numbered = typeof row[srNoCol] === 'number';
        if (numbered) {
          seenNumberedRow = true;
        } else if (seenNumberedRow) {
          break;
        }
      }

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

  // A date typed into two different month blocks (February's table carrying an 11-Mar header,
  // March's carrying a 10-Feb one) gives that day two sets of figures under one record key, so
  // one month's numbers overwrite the other's and the day that was mistyped gets none at all.
  // Only the sheet can say which is right, so this reports it rather than guessing.
  const blocksByDate = new Map();
  headerRowIndexes.forEach((headerRowIdx) => {
    (rows[headerRowIdx] || []).forEach((cell) => {
      if (!isPlausibleDateSerial(cell)) return;
      const key = serialToDate(cell).toISOString().slice(0, 10);
      if (!blocksByDate.has(key)) blocksByDate.set(key, new Set());
      blocksByDate.get(key).add(headerRowIdx);
    });
  });
  for (const [date, blocks] of blocksByDate) {
    if (blocks.size > 1) {
      warnings.push(
        `${date} is listed in ${blocks.size} different month tables in the Manpower sheet (header rows ${[...blocks].join(', ')}) — those figures overwrite each other, and the day that was mistyped has none at all. Check those date headers.`,
      );
    }
  }

  return { records, warnings };
}
