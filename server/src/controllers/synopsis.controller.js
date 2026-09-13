import { SynopsisMonth } from '../models/SynopsisMonth.js';
import { SynopsisDispatchRecord } from '../models/SynopsisDispatchRecord.js';
import { roundDeep } from '../utils/roundNumbers.js';
import { latestDataAsOf } from './dashboard.controller.js';

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month) {
  const [year, mm] = month.split('-');
  return `${MONTH_LABELS[Number(mm) - 1]} ${year}`;
}

function dayLabel(date) {
  return `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()].slice(0, 3)} ${date.getUTCFullYear()}`;
}

const isoDay = (date) => date.toISOString().slice(0, 10);

// The view can be scoped three ways. A plain string or null is still accepted so the offline
// checker (scripts/checkSynopsis.js) keeps working unchanged.
function normalizeScope(scope) {
  if (!scope) return { type: 'all' };
  if (typeof scope === 'string') return { type: 'month', month: scope };
  if (scope.from && scope.to) {
    const from = new Date(scope.from);
    const to = new Date(scope.to);
    from.setUTCHours(0, 0, 0, 0);
    to.setUTCHours(23, 59, 59, 999);
    return { type: 'range', from, to };
  }
  if (scope.month && scope.month !== 'all') return { type: 'month', month: scope.month };
  return { type: 'all' };
}

// How much of each month's plan belongs to the current scope. A month sitting wholly inside
// counts for all of it; a month the range only clips counts for the share of its reported days
// that the range actually contains, and its plan is pro-rated by that same share.
//
// Pro-rating is the only honest option here: the workbooks set targets per month, never per
// day, so "planned" for 15 Apr – 20 May has no figure of its own in the source. Spreading each
// month's target evenly across the days it reported matches how the plan-pace line already
// works, and keeps achieved-% meaningful for a part-month window instead of comparing a few
// days of dispatch against a whole month's target.
function buildPlanFactors(scopedMonths, scope) {
  const factors = new Map();
  for (const doc of scopedMonths) {
    if (scope.type !== 'range') {
      factors.set(doc.month, 1);
      continue;
    }
    const total = doc.coveredDates.length;
    const inside = doc.coveredDates.filter((d) => d >= scope.from && d <= scope.to).length;
    factors.set(doc.month, total > 0 ? inside / total : 0);
  }
  return factors;
}

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

// Planned comes from the month documents (pro-rated by `factors`), dispatched from the
// day-level records. Dispatched has to come from the records because they are the only thing
// that can be cut to an arbitrary date range — a month document only knows its own total. For
// a whole month the two agree exactly, since a month's stored total is the sum of those same
// records.
//
// Seeding from the plan first matters: a department that was planned but dispatched nothing in
// the window still has to appear, as a bar at zero against its target, rather than silently
// dropping out of the comparison.
function buildDepartmentRows(monthDocs, records, factors) {
  // A department can hold two rows in one month (June onwards splits Adani and RIL into an
  // in-house and a buyout line) and one row in each of several months. Both are folded into a
  // single figure per department here; the in-house/buyout split is its own breakdown below.
  const rows = new Map();
  const ensure = (department, category) => {
    if (!rows.has(department)) {
      rows.set(department, { department, category, planned: 0, dispatched: 0, months: 0 });
    }
    return rows.get(department);
  };

  for (const doc of monthDocs) {
    const factor = factors.get(doc.month) ?? 1;
    if (factor === 0) continue;
    for (const dept of doc.departments) {
      const row = ensure(dept.department, dept.category);
      row.planned += (dept.planned || 0) * factor;
      row.months += 1;
    }
  }

  for (const record of records) {
    ensure(record.department, record.category).dispatched += record.qty;
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      balance: row.planned - row.dispatched,
      achievedPct: row.planned > 0 ? (row.dispatched / row.planned) * 100 : null,
    }))
    .sort((a, b) => b.dispatched - a.dispatched);
}

function buildModeRows(monthDocs, records, factors) {
  const rows = new Map();
  const ensure = (mode) => {
    if (!rows.has(mode)) rows.set(mode, { mode, planned: 0, dispatched: 0 });
    return rows.get(mode);
  };

  for (const doc of monthDocs) {
    const factor = factors.get(doc.month) ?? 1;
    if (factor === 0) continue;
    for (const dept of doc.departments) {
      ensure(dept.mode).planned += (dept.planned || 0) * factor;
    }
  }

  for (const record of records) {
    ensure(record.mode).dispatched += record.qty;
  }

  return [...rows.values()]
    .map((row) => ({ ...row, achievedPct: row.planned > 0 ? (row.dispatched / row.planned) * 100 : null }))
    .sort((a, b) => b.dispatched - a.dispatched);
}

// Departments biggest-first over the whole history, not just the current scope, so the grid
// below keeps the same rows in the same order whatever the filter is set to.
function allTimeDepartmentOrder(monthDocs) {
  const totals = new Map();
  for (const doc of monthDocs) {
    for (const dept of doc.departments) {
      totals.set(dept.department, (totals.get(dept.department) || 0) + dept.dispatched);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([department]) => department);
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
export function buildSynopsisPayload(allMonths, records, requestedScope) {
  const scope = normalizeScope(requestedScope);

  const scopedMonths =
    scope.type === 'month'
      ? allMonths.filter((m) => m.month === scope.month)
      : scope.type === 'range'
        // A month is in scope when the range touches any of its reported days, so a range
        // ending mid-month still brings that month's plan in (pro-rated below).
        ? allMonths.filter((m) => m.coveredDates.some((d) => d >= scope.from && d <= scope.to))
        : allMonths;

  const factors = buildPlanFactors(scopedMonths, scope);

  const categoryTotals = sumBy(records, (r) => r.category, (r) => r.qty);
  const dispatched = [...categoryTotals.values()].reduce((sum, v) => sum + v, 0);
  const categoryKeys = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);

  const dailySeries = buildDailySeries(records, categoryKeys);
  const coveredDates = scopedMonths
    .flatMap((m) => m.coveredDates)
    .filter((d) => scope.type !== 'range' || (d >= scope.from && d <= scope.to));
  const plannedTotal = scopedMonths.reduce((sum, m) => sum + (m.plannedTotal || 0) * (factors.get(m.month) ?? 1), 0);
  const byDepartment = buildDepartmentRows(scopedMonths, records, factors);

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
      // Both ends of each month's reported window, so the date picker can refuse days the
      // workbooks say nothing about instead of returning an empty dashboard.
      firstDate: m.coveredDates.length > 0 ? m.coveredDates[0] : null,
      lastDate: m.coveredDates.length > 0 ? m.coveredDates[m.coveredDates.length - 1] : null,
      sourceFile: m.sourceFile,
    })),
    scope: {
      type: scope.type,
      month: scope.type === 'month' ? scope.month : 'all',
      from: scope.type === 'range' ? scope.from : null,
      to: scope.type === 'range' ? scope.to : null,
      // Derived from the months actually present rather than hard-coded, so the label stays
      // right the moment a new month's workbook lands in the folder.
      label:
        scope.type === 'month'
          ? monthLabel(scope.month)
          : scope.type === 'range'
            ? `${dayLabel(scope.from)} – ${dayLabel(scope.to)}`
            : allMonths.length === 0
              ? 'All months'
              : allMonths.length === 1
                ? monthLabel(allMonths[0].month)
                : `${monthLabel(allMonths[0].month)} – ${monthLabel(allMonths[allMonths.length - 1].month)}`,
      // Says whether "planned" for this scope is a figure the workbooks state outright or one
      // spread across part of a month, so the UI can label it honestly.
      plannedIsProRated: scope.type === 'range' && [...factors.values()].some((f) => f > 0 && f < 1),
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
    byMode: buildModeRows(scopedMonths, records, factors),
    daily: dailySeries,
    cumulative: buildCumulative(dailySeries, coveredDates, plannedTotal),
    monthlyTrend,
    departmentMatrix: buildDepartmentMatrix(allMonths, allTimeDepartmentOrder(allMonths)),
    ...buildTowerSummary(scopedMonths),
    warnings: scopedMonths.flatMap((m) => m.warnings || []),
  };

  return roundDeep(payload);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (value) =>
  typeof value === 'string' && DAY_PATTERN.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export async function getSynopsisSummary(req, res) {
  const { from, to, month } = req.query;
  if (month !== undefined && (typeof month !== 'string' || (month !== 'all' && !/^\d{4}-\d{2}$/.test(month)))) {
    return res.status(400).json({ message: 'month must be YYYY-MM or "all".' });
  }
  const requestedMonth = month && month !== 'all' ? month : null;

  // A range wins over a month if both arrive, since the range is the more specific request.
  // The query below is built from exactly the strings validated here: validation used to
  // accept anything `new Date()` could read ("2026-01-01T05:00") while the query appended its
  // own time to it and silently searched for Invalid Date.
  let scope = requestedMonth;
  if (from !== undefined || to !== undefined) {
    if (!isRealDay(from) || !isRealDay(to)) {
      return res.status(400).json({ message: 'from and to must both be valid dates (YYYY-MM-DD).' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'from must not be after to.' });
    }
    scope = { from, to };
  }

  const [allMonths, dataAsOf] = await Promise.all([SynopsisMonth.find().sort({ month: 1 }).lean(), latestDataAsOf()]);
  if (allMonths.length === 0) return res.json({ ...EMPTY_SYNOPSIS, dataAsOf });

  if (requestedMonth && !scope?.from && !allMonths.some((m) => m.month === requestedMonth)) {
    return res.status(404).json({ message: `No synopsis data for ${requestedMonth}.` });
  }

  const query = scope?.from
    ? { date: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } }
    : { month: { $in: requestedMonth ? [requestedMonth] : allMonths.map((m) => m.month) } };

  const records = await SynopsisDispatchRecord.find(query).sort({ date: 1 }).lean();

  return res.json({ ...buildSynopsisPayload(allMonths, records, scope), dataAsOf, generatedAt: new Date() });
}
