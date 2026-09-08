import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { fetchSynopsisSummary } from '../../lib/api';
import { StatCard } from './StatCard';
import { DateRangePicker } from './DateRangePicker';
import {
  CategoryShareChart,
  DailyDispatchChart,
  DepartmentAchievementChart,
  DepartmentMatrix,
  DepartmentPlanChart,
  DepartmentTable,
  MonthlyAchievementChart,
  MonthlyPlanChart,
  // Switched off on request — the components are still exported from SynopsisCharts.jsx, so
  // putting any of these back is a matter of restoring its import and its line in the grid:
  //   CumulativePaceChart  — "Cumulative dispatch against plan pace"
  //   ModeShareChart       — "In-house, job work and buyout"
  //   TowerChart           — "Towers and poles dispatched"
} from './SynopsisCharts';
import { ACTUAL_COLOR, achievementColor, formatMt, formatMtWhole, formatPct } from './synopsisPalette';

function ScopePicker({ months, scope, onChange }) {
  // The calendar is held to the span the workbooks actually report on. Picking a day outside
  // it could only ever return an empty dashboard, so it is not offered.
  const withDates = months.filter((m) => m.firstDate && m.lastDate);
  const dataFrom = withDates.length > 0 ? new Date(withDates[0].firstDate) : undefined;
  const dataTo = withDates.length > 0 ? new Date(withDates[withDates.length - 1].lastDate) : undefined;

  function button(label, isActive, onClick, title) {
    return (
      <button
        key={label}
        onClick={onClick}
        title={title}
        className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        style={{
          background: isActive ? 'var(--series-1)' : 'transparent',
          color: isActive ? '#ffffff' : 'var(--text-secondary)',
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border p-1.5" style={{ background: 'var(--surface-1)' }}>
      {button('All months', scope.mode === 'all', () => onChange({ mode: 'all' }))}
      {months.map((m) =>
        button(
          m.label.replace(' 20', " '"),
          scope.mode === 'month' && scope.month === m.month,
          () => onChange({ mode: 'month', month: m.month }),
          `${m.label} — ${m.coveredDays} reported days`,
        ),
      )}
      <DateRangePicker
        isActive={scope.mode === 'range'}
        value={scope.mode === 'range' ? { from: scope.from, to: scope.to } : undefined}
        onApply={({ from, to }) => onChange({ mode: 'range', from, to })}
        disabled={dataFrom && dataTo ? { before: dataFrom, after: dataTo } : undefined}
        defaultMonth={dataTo}
        label="Custom range"
      />
    </div>
  );
}

export function SynopsisView() {
  const [scope, setScope] = useState({ mode: 'all' });

  const params =
    scope.mode === 'range'
      ? { from: format(scope.from, 'yyyy-MM-dd'), to: format(scope.to, 'yyyy-MM-dd') }
      : { month: scope.mode === 'month' ? scope.month : 'all' };

  const query = useQuery({
    queryKey: ['synopsis', params],
    queryFn: () => fetchSynopsisSummary(params),
    placeholderData: keepPreviousData,
    // Matches the rest of the dashboard: the figures stay as first loaded for the session, so
    // a background sync never shifts numbers under someone who is reading them.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const data = query.data;

  if (query.isLoading) {
    return (
      <div className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Loading synopsis dispatch…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
        Couldn&apos;t load the synopsis dispatch reports. {query.error?.response?.data?.message || query.error?.message}
      </div>
    );
  }

  if (!data?.available) {
    return (
      <div className="rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
        No synopsis dispatch workbooks have been read yet. They are picked up from the monthly synopsis folder on the next sync — an
        admin can run one from the badge at the top of this page.
      </div>
    );
  }

  // Named apart from the `scope` state above: this one is what the server resolved the request
  // to, and the two are read side by side below.
  const { kpis, scope: appliedScope } = data;
  const isAllMonths = scope.mode === 'all';
  const picker = <ScopePicker months={data.availableMonths} scope={scope} onChange={setScope} />;

  if (kpis.coveredDays === 0) {
    return (
      <div>
        <div className="mb-6">{picker}</div>
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
          No dispatch was reported between {appliedScope.label}. Pick a different range, or choose All months to see everything on record.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {picker}
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {kpis.coveredDays} reported days
          {kpis.idleDays > 0 && `, ${kpis.idleDays} with no dispatch`}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {appliedScope.label}
        </span>
        {appliedScope.plannedIsProRated && (
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
            title="The workbooks set targets per month, never per day. For a range that covers only part of a month, that month's target is shared out evenly across the days it reported, so the achieved figure compares like with like."
          >
            · plan pro-rated to the days in this range
          </span>
        )}
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="mb-6 flex items-stretch gap-3 overflow-x-auto"
      >
        <StatCard compact label="Planned" value={formatMtWhole(kpis.planned)} unit="MT" accent="var(--text-muted)" />
        <StatCard compact label="Dispatched" value={formatMtWhole(kpis.dispatched)} unit="MT" accent={ACTUAL_COLOR} />
        <StatCard
          compact
          label="Plan achieved"
          value={formatPct(kpis.achievedPct)}
          accent={achievementColor(kpis.achievedPct)}
        />
        <StatCard compact label="Balance to dispatch" value={formatMtWhole(kpis.balance)} unit="MT" accent="var(--series-8)" />
        <StatCard compact label="Average per day" value={formatMt(kpis.avgPerCoveredDay)} unit="MT" accent="var(--series-3)" />
        {kpis.bestDay && (
          <StatCard
            compact
            label={`Best day (${format(new Date(kpis.bestDay.date), 'd MMM')})`}
            value={formatMt(kpis.bestDay.total)}
            unit="MT"
            accent="var(--series-7)"
          />
        )}
      </motion.div>

      <div className="mb-4">
        <DepartmentTable byDepartment={data.byDepartment} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* The month-level charts always show whole months, so they are only shown when the
            filter is on whole months too — under a custom range their bars would silently
            disagree with everything else on the page. */}
        {isAllMonths && <MonthlyPlanChart monthlyTrend={data.monthlyTrend} />}
        {isAllMonths && <MonthlyAchievementChart monthlyTrend={data.monthlyTrend} />}

        <DailyDispatchChart daily={data.daily} categoryKeys={data.categoryKeys} scopeLabel={appliedScope.label} />

        <CategoryShareChart byCategory={data.byCategory} />

        <DepartmentPlanChart byDepartment={data.byDepartment} />
        <DepartmentAchievementChart byDepartment={data.byDepartment} />

        {isAllMonths && <DepartmentMatrix departmentMatrix={data.departmentMatrix} />}

        {/* Switched off on request:
        <CumulativePaceChart cumulative={data.cumulative} scopeLabel={appliedScope.label} />
        <ModeShareChart byMode={data.byMode} />
        <TowerChart towers={data.towers} towersByMonth={data.towersByMonth} totals={data.totals} />
        */}
      </div>

      {data.warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border p-5" style={{ background: 'var(--surface-1)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Notes from the source workbooks
          </div>
          <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {data.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
