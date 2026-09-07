import { SynopsisMonth } from '../models/SynopsisMonth.js';
import { SynopsisDispatchRecord } from '../models/SynopsisDispatchRecord.js';
import { roundDeep } from '../utils/roundNumbers.js';

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month) {
  const [year, mm] = month.split('-');
  return `${MONTH_LABELS[Number(mm) - 1]} ${year}`;
}

const isoDay = (date) => date.toISOString().slice(0, 10);

// Everything here is computed in JS rather than through aggregation pipelines. The whole
// dataset is one document per month and a few hundred dispatch rows, so the cost is
// negligible, and every figure below needs the month's plan and reporting window joined onto
// the daily rows — which as pipelines would be several $lookup stages for no gain in clarity.
function sumBy(items, keyOf, valueOf) {
  const totals = new Map();
  for (const item of items) {
    const key = keyOf(item);
    totals.set(key, (totals.get(key) || 0) + valueOf(item));
  }
  return totals;
}

function buildDailySeries(records, categoryKeys) {
  const byDate = new Map();
  for (const record of records) {
    const key = isoDay(record.date);
    if (!byDate.has(key)) {
      byDate.set(key, { date: record.date, total: 0, ...Object.fromEntries(categoryKeys.map((c) => [c, 0])) });
    }
    const row = byDate.get(key);
    row[record.category] = (row[record.category] || 0) + record.qty;
    row.total += record.qty;
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date);
}

// Actual tonnage accumulated against the pace the plan implies. The plan line is spread
// evenly across the days the report covers rather than the calendar month, so a part-reported
// month (July stops at the 16th) is measured against the share of its plan that those days
// should have delivered — not against a full month's target it was never going to reach.
function buildCumulative(dailySeries, coveredDates, plannedTotal) {
  const covered = [...coveredDates].sort((a, b) => a - b);
  const perDayPlan = covered.length > 0 ? plannedTotal / covered.length : 0;
  const dispatchedByDay = new Map(dailySeries.map((d) => [isoDay(d.date), d.total]));

  let actual = 0;
  return covered.map((date, i) => {
    actual += dispatchedByDay.get(isoDay(date)) || 0;
    return { date, actual, plan: perDayPlan * (i + 1) };
  });
}

function buildDepartmentRows(monthDocs) {
  // A department can hold two rows in one month (June onwards splits Adani and RIL into an
  // in-house and a buyout line) and one row in each of several months. Both are folded into a
  // single figure per department here; the in-house/buyout split is its own breakdown below.
  const rows = new Map();
  for (const doc of monthDocs) {
    for (const dept of doc.departments) {
      if (!rows.has(dept.department)) {
        rows.set(dept.department, { department: dept.department, category: dept.category, planned: 0, dispatched: 0, months: 0 });
      }
      const row = rows.get(dept.department);
      row.planned += dept.planned || 0;
      row.dispatched += dept.dispatched;
      row.months += 1;
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      balance: row.planned - row.dispatched,
      achievedPct: row.planned > 0 ? (row.dispatched / row.planned) * 100 : null,
    }))
    .sort((a, b) => b.dispatched - a.dispatched);
}

function buildModeRows(monthDocs) {
  const rows = new Map();
  for (const doc of monthDocs) {
    for (const dept of doc.departments) {
      if (!rows.has(dept.mode)) rows.set(dept.mode, { mode: dept.mode, planned: 0, dispatched: 0 });
      const row = rows.get(dept.mode);
      row.planned += dept.planned || 0;
      row.dispatched += dept.dispatched;
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, achievedPct: row.planned > 0 ? (row.dispatched / row.planned) * 100 : null }))
    .sort((a, b) => b.dispatched - a.dispatched);
}

// A department-by-month grid. Every month gets an entry for every department, null where that
// department did not exist in that month's report at all — which is not the same as a month
// where it was planned and dispatched nothing, and the two must not render alike.
function buildDepartmentMatrix(monthDocs, departmentOrder) {
  const months = monthDocs.map((d) => d.month);
  const present = new Map();
  for (const doc of monthDocs) {
    for (const dept of doc.departments) {
      const key = `${dept.department}|${doc.month}`;
      present.set(key, (present.get(key) || 0) + dept.dispatched);
    }
  }

  return {
    months: months.map((m) => ({ month: m, label: monthLabel(m) })),
    rows: departmentOrder.map((department) => ({
      department,
      cells: months.map((month) => ({
        month,
        dispatched: present.has(`${department}|${month}`) ? present.get(`${department}|${month}`) : null,
      })),
    })),
  };
}

// The tower synopsis is headed "Dispatched Till <date>", which reads as a running cumulative
// count — but it is not one, and treating it as one would be badly wrong. Its own monthly
// totals go 1,507 → 4,613 → 2,915 → 5 → 3, and a cumulative figure cannot fall; the counts
// also drop to blank in exactly the months a model's tonnage is zero (Nepal Pole in July and
// August). Both say these are per-month counts, so they are added across the months in scope.
function buildTowerSummary(monthDocs) {
  const byModel = new Map();
  const byMonth = [];

  for (const doc of monthDocs) {
    let monthTowers = 0;
    let monthCip = 0;

    for (const tower of doc.towers) {
      const key = `${tower.model}|${tower.heightM ?? ''}`;
      if (!byModel.has(key)) {
        byModel.set(key, {
          model: tower.model,
          heightM: tower.heightM,
          towerNos: 0,
          cipNos: 0,
          weightMt: 0,
          months: [],
        });
      }
      const row = byModel.get(key);
      row.towerNos += tower.towerNos || 0;
      row.cipNos += tower.cipNos || 0;
      row.weightMt += tower.weightMt || 0;
      if (tower.towerNos || tower.cipNos) row.months.push(monthLabel(doc.month));

      monthTowers += tower.towerNos || 0;
      monthCip += tower.cipNos || 0;
    }

    byMonth.push({ month: doc.month, label: monthLabel(doc.month), shortLabel: monthLabel(doc.month).slice(0, 3), towerNos: monthTowers, cipNos: monthCip });
  }

  const towers = [...byModel.values()]
    .filter((t) => t.towerNos > 0 || t.cipNos > 0 || t.weightMt > 0)
    .sort((a, b) => b.towerNos - a.towerNos);

  return {
    towers,
    towersByMonth: byMonth,
    totals: {
      towerNos: towers.reduce((sum, t) => sum + t.towerNos, 0),
      cipNos: towers.reduce((sum, t) => sum + t.cipNos, 0),
    },
  };
}

export const EMPTY_SYNOPSIS = {
  available: false,
  availableMonths: [],
  scope: { month: 'all', label: 'All months' },
  kpis: null,
  warnings: [],
};

// Split out from the request handler so the whole reshape can be exercised against the real
// workbooks without a database in front of it (see scripts/checkSynopsis.js).
export function buildSynopsisPayload(allMonths, records, requestedMonth) {
  const scopedMonths = requestedMonth ? allMonths.filter((m) => m.month === requestedMonth) : allMonths;

  const categoryTotals = sumBy(records, (r) => r.category, (r) => r.qty);
  const dispatched = [...categoryTotals.values()].reduce((sum, v) => sum + v, 0);
  const categoryKeys = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);

  const dailySeries = buildDailySeries(records, categoryKeys);
  const coveredDates = scopedMonths.flatMap((m) => m.coveredDates);
  const plannedTotal = scopedMonths.reduce((sum, m) => sum + (m.plannedTotal || 0), 0);
  const byDepartment = buildDepartmentRows(scopedMonths);

  const bestDay = dailySeries.reduce((best, day) => (best === null || day.total > best.total ? day : best), null);

  const monthlyTrend = allMonths.map((m) => {
    const [year, mm] = m.month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    return {
      month: m.month,
      label: monthLabel(m.month),
      shortLabel: monthLabel(m.month).slice(0, 3),
      planned: m.plannedTotal || 0,
      dispatched: m.dispatchedTotal || 0,
      balance: (m.plannedTotal || 0) - (m.dispatchedTotal || 0),
      achievedPct: m.plannedTotal > 0 ? ((m.dispatchedTotal || 0) / m.plannedTotal) * 100 : null,
      coveredDays: m.coveredDates.length,
      daysInMonth,
      // A month whose report stops partway (July's rows end on the 16th) is flagged so the
      // charts can say so, instead of its short bar reading as a collapse in output.
      partial: m.coveredDates.length < daysInMonth,
      lastDate: m.coveredDates.length > 0 ? m.coveredDates[m.coveredDates.length - 1] : null,
    };
  });

  const activeDays = dailySeries.length;
  const coveredDayCount = coveredDates.length;

  const payload = {
    available: true,
    availableMonths: allMonths.map((m) => ({
      month: m.month,
      label: monthLabel(m.month),
      shortLabel: monthLabel(m.month).slice(0, 3),
      coveredDays: m.coveredDates.length,
      lastDate: m.coveredDates.length > 0 ? m.coveredDates[m.coveredDates.length - 1] : null,
      sourceFile: m.sourceFile,
    })),
    scope: {
      month: requestedMonth || 'all',
      label: requestedMonth ? monthLabel(requestedMonth) : 'April – August 2026',
    },
    kpis: {
      planned: plannedTotal,
      dispatched,
      balance: plannedTotal - dispatched,
      achievedPct: plannedTotal > 0 ? (dispatched / plannedTotal) * 100 : null,
      coveredDays: coveredDayCount,
      activeDays,
      // Averaged over the days the report covers, including the ones that dispatched nothing —
      // averaging only over active days would overstate the plant's real daily rate.
      avgPerCoveredDay: coveredDayCount > 0 ? dispatched / coveredDayCount : 0,
      idleDays: coveredDayCount - activeDays,
      bestDay: bestDay ? { date: bestDay.date, total: bestDay.total } : null,
      departmentCount: byDepartment.length,
      monthCount: scopedMonths.length,
    },
    categoryKeys,
    byCategory: categoryKeys.map((category) => ({
      category,
      dispatched: categoryTotals.get(category),
      share: dispatched > 0 ? (categoryTotals.get(category) / dispatched) * 100 : 0,
    })),
    byDepartment,
    byMode: buildModeRows(scopedMonths),
    daily: dailySeries,
    cumulative: buildCumulative(dailySeries, coveredDates, plannedTotal),
    monthlyTrend,
    departmentMatrix: buildDepartmentMatrix(allMonths, buildDepartmentRows(allMonths).map((d) => d.department)),
    ...buildTowerSummary(scopedMonths),
    warnings: scopedMonths.flatMap((m) => m.warnings || []),
  };

  return roundDeep(payload);
}

export async function getSynopsisSummary(req, res) {
  const requestedMonth = req.query.month && req.query.month !== 'all' ? req.query.month : null;

  const allMonths = await SynopsisMonth.find().sort({ month: 1 }).lean();
  if (allMonths.length === 0) return res.json(EMPTY_SYNOPSIS);

  if (requestedMonth && !allMonths.some((m) => m.month === requestedMonth)) {
    return res.status(404).json({ message: `No synopsis data for ${requestedMonth}.` });
  }

  const months = requestedMonth ? [requestedMonth] : allMonths.map((m) => m.month);
  const records = await SynopsisDispatchRecord.find({ month: { $in: months } }).sort({ date: 1 }).lean();

  return res.json(buildSynopsisPayload(allMonths, records, requestedMonth));
}
