import { isPlausibleDateSerial, serialToDate } from '../../utils/sheetDate.js';
import { normalizeStageLabel } from './stageAliases.js';
import { normalizeClient } from './clientAliases.js';
import { findHeaderRowIndexes } from './gridUtils.js';

const isoDay = (date) => date.toISOString().slice(0, 10);
const isoMonth = (date) => date.toISOString().slice(0, 7);

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

// The month a block reports on is the one most of its date columns fall in. Every block also
// carries a few columns for the first days of the *next* month (Nov's block runs on to 1 Dec,
// January's to "02-02" and "02-03"), and those same dates reappear, sometimes with different
// figures, at the start of the next block.
function majorityMonth(dates) {
  const counts = new Map();
  for (const date of dates) counts.set(isoMonth(date), (counts.get(isoMonth(date)) || 0) + 1);
  let best = null;
  for (const [month, count] of counts) if (!best || count > best.count) best = { month, count };
  return best?.month ?? null;
}

// The block's own client cell ("ADANI", "MHI", "RIL" next to "SL.No" in the date header row).
// For May–Nov 2025 the "L&T MHI Progress" tab holds blocks headed "RIL", identical figure for
// figure to the RIL tab. Taking the client from the tab name counted that steel twice, once
// under each client (2,427 MT of final coat alone; docs/DATA_ACCURACY_REPORT.md DA-01). The
// sheet's own label is what says whose production a block is, so it wins over the tab.
function blockClientLabel(headerRow) {
  for (const cell of headerRow) {
    if (typeof cell !== 'string') continue;
    const client = normalizeClient(cell);
    if (client) return { client, label: cell.trim() };
  }
  return null;
}

// A single day's increment claiming to account for almost the entire running cumulative total
// is never real production data mid-month — it's the signature of catching the source sheet in
// a momentary bad state (e.g. synced while someone was mid-edit on that cell). Seen in practice:
// a cumulative of 4937 recorded with dailyIncrementQty also 4937, which would only make sense if
// that were day one of tracking. Guard against it rather than let one bad cell inflate every
// chart and total built from this stage for as long as the sheet happens to hold that value.
//
// Day one of tracking, and the first day after a genuine reset, have exactly that shape and are
// real — so the guard only applies once the stage already has a running total that this day's
// cumulative continues from.
const SUSPICIOUS_INCREMENT_RATIO = 0.9;
const SUSPICIOUS_INCREMENT_FLOOR = 50;

function isSuspiciousIncrement(dailyIncrementQty, cumulativeQty, previousCumulative) {
  if (typeof previousCumulative !== 'number' || previousCumulative <= 0 || cumulativeQty < previousCumulative) return false;
  return cumulativeQty >= SUSPICIOUS_INCREMENT_FLOOR && dailyIncrementQty >= cumulativeQty * SUSPICIOUS_INCREMENT_RATIO;
}

export function parseProgressSheet(rows, client, sourceTab) {
  const warnings = [];

  const headerRowIndexes = findHeaderRowIndexes(rows);
  if (headerRowIndexes.length === 0) {
    warnings.push(`No date header rows detected in ${sourceTab}.`);
    return { records: [], warnings };
  }

  const candidates = [];
  const previousCumulative = new Map();

  headerRowIndexes.forEach((headerRowIdx, i) => {
    const headerRow = rows[headerRowIdx];
    const dataStart = headerRowIdx + 1;
    const dataEnd = headerRowIndexes[i + 1] ?? rows.length;
    const datePairs = buildDateColumnPairs(headerRow);
    const blockMonth = majorityMonth(datePairs.map((p) => p.date));

    const labelled = blockClientLabel(headerRow);
    const blockClient = labelled?.client ?? client;
    if (labelled && labelled.client !== client) {
      warnings.push(
        `${sourceTab}: the ${blockMonth} block (row ${headerRowIdx}) is headed "${labelled.label}", so its figures are recorded under ${labelled.client}, not ${client}. Move it to the ${labelled.client} tab or correct its heading.`,
      );
    }

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

        const stageKey = `${blockClient}|${stage}`;
        if (isSuspiciousIncrement(dailyIncrementQty, cumulativeQty, previousCumulative.get(stageKey))) {
          warnings.push(
            `Suspicious daily increment for ${blockClient} ${stage} on ${isoDay(date)}: ` +
              `increment ${dailyIncrementQty} is implausibly close to the cumulative total ${cumulativeQty} ` +
              `(row ${r}, col ${incrementCol}) — treated as 0 rather than trusted.`,
          );
          dailyIncrementQty = 0;
        }
        previousCumulative.set(stageKey, cumulativeQty);

        candidates.push({
          inMonth: isoMonth(date) === blockMonth,
          blockMonth,
          record: {
            date,
            client: blockClient,
            processStage: stage,
            cumulativeQty,
            dailyIncrementQty,
            sourceTab,
            sourceRowIndex: r,
            sourceCol: cumulativeCol,
          },
        });
      });
    }
  });

  // One record per date + client + stage — the key the database stores them under. Before this,
  // a date parsed from two blocks was simply written twice and whichever came last silently won.
  // A block's own month now takes precedence over another block's trailing columns; a trailing
  // column is only used when no block covers that date as its own month. Disagreeing figures
  // for the same day are reported, since only the sheet can say which one is right.
  const byKey = new Map();
  for (const candidate of candidates) {
    const { record } = candidate;
    const key = `${isoDay(record.date)}|${record.client}|${record.processStage}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const differs =
      existing.record.cumulativeQty !== record.cumulativeQty || existing.record.dailyIncrementQty !== record.dailyIncrementQty;
    const keepNew = candidate.inMonth || !existing.inMonth;
    const kept = keepNew ? candidate : existing;
    if (differs) {
      const dropped = keepNew ? existing : candidate;
      warnings.push(
        `${sourceTab}: ${isoDay(record.date)} ${record.client} ${record.processStage} appears in two blocks with different figures ` +
          `(row ${kept.record.sourceRowIndex}: ${kept.record.cumulativeQty}/${kept.record.dailyIncrementQty}, ` +
          `row ${dropped.record.sourceRowIndex}: ${dropped.record.cumulativeQty}/${dropped.record.dailyIncrementQty}) — ` +
          `using the ${kept.blockMonth} block's.`,
      );
    }
    byKey.set(key, kept);
  }

  return { records: [...byKey.values()].map((c) => c.record), warnings };
}
