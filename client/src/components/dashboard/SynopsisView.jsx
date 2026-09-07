import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { fetchSynopsisSummary } from '../../lib/api';
import { StatCard } from './StatCard';
import {
  CategoryShareChart,
  CumulativePaceChart,
  DailyDispatchChart,
  DepartmentAchievementChart,
  DepartmentMatrix,
  DepartmentPlanChart,
  DepartmentTable,
  ModeShareChart,
  MonthlyAchievementChart,
  MonthlyPlanChart,
  TowerChart,
} from './SynopsisCharts';
import { ACTUAL_COLOR, achievementColor, formatMt, formatMtWhole, formatPct } from './synopsisPalette';

function MonthPicker({ months, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border p-1.5" style={{ background: 'var(--surface-1)' }}>
      <button
        onClick={() => onChange('all')}
        className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        style={{
          background: value === 'all' ? 'var(--series-1)' : 'transparent',
          color: value === 'all' ? '#ffffff' : 'var(--text-secondary)',
        }}
      >
        All months
      </button>
      {months.map((m) => (
        <button
          key={m.month}
          onClick={() => onChange(m.month)}
          title={`${m.label} — ${m.coveredDays} reported days`}
          className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            background: value === m.month ? 'var(--series-1)' : 'transparent',
            color: value === m.month ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          {m.label.replace(' 20', " '")}
        </button>
      ))}
    </div>
  );
}

export function SynopsisView() {
  const [month, setMonth] = useState('all');

  const query = useQuery({
    queryKey: ['synopsis', month],
    queryFn: () => fetchSynopsisSummary({ month }),
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

  const { kpis, scope } = data;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker months={data.availableMonths} value={month} onChange={setMonth} />
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {kpis.coveredDays} reported days
          {kpis.idleDays > 0 && `, ${kpis.idleDays} with no dispatch`}
        </div>
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {scope.label}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Month-level charts only earn their space when more than one month is in view. */}
        {month === 'all' && <MonthlyPlanChart monthlyTrend={data.monthlyTrend} />}
        {month === 'all' && <MonthlyAchievementChart monthlyTrend={data.monthlyTrend} />}

        <DailyDispatchChart daily={data.daily} categoryKeys={data.categoryKeys} scopeLabel={scope.label} />
        <CumulativePaceChart cumulative={data.cumulative} scopeLabel={scope.label} />

        <CategoryShareChart byCategory={data.byCategory} />
        <ModeShareChart byMode={data.byMode} />

        <DepartmentPlanChart byDepartment={data.byDepartment} />
        <DepartmentAchievementChart byDepartment={data.byDepartment} />

        {month === 'all' && <DepartmentMatrix departmentMatrix={data.departmentMatrix} />}

        <TowerChart towers={data.towers} towersByMonth={data.towersByMonth} totals={data.totals} />
      </div>

      <div className="mt-4">
        <DepartmentTable byDepartment={data.byDepartment} />
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
