import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { fetchHsdSummary, fetchSyncStatus } from '../lib/api';
import { FilterBar, PRESETS, formatRangeLabel } from '../components/dashboard/FilterBar';
import { StatCard } from '../components/dashboard/StatCard';
import { useAuth } from '../context/AuthContext';
import { ManpowerTrendChart, ManpowerCategoryChart } from '../components/dashboard/ManpowerChart';
import { ProductionTrendChart, ProductionStageChart, ProductionClientChart } from '../components/dashboard/ProductionChart';
import { DispatchTrendChart, DispatchClientChart } from '../components/dashboard/DispatchChart';
import { PendingByClientChart } from '../components/dashboard/PendingChart';
import { TargetPanel } from '../components/dashboard/TargetPanel';
import { SyncStatusBadge } from '../components/dashboard/SyncStatusBadge';
import { useSyncSocket } from '../hooks/useSyncSocket';

export function Dashboard() {
  const [preset, setPreset] = useState('Last 30 days');
  const [range, setRange] = useState(PRESETS[2].getRange());
  const [businessUnit, setBusinessUnit] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const params = {
    from: format(range.from, 'yyyy-MM-dd'),
    to: format(range.to, 'yyyy-MM-dd'),
    ...(businessUnit ? { businessUnit } : {}),
  };

  const summaryQuery = useQuery({
    queryKey: ['hsd-summary', params],
    queryFn: () => fetchHsdSummary(params),
  });

  const syncStatusQuery = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 60_000,
  });

  const handleSynced = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['hsd-summary'] });
    queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  }, [queryClient]);

  useSyncSocket(handleSynced);

  const summary = summaryQuery.data;
  const totalPending = summary
    ? Math.round(summary.pending.reduce((sum, p) => sum + p.pending, 0) * 1000) / 1000
    : null;
  const knownClients = summary?.pending.map((p) => p.client) ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            HSD Overview
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {formatRangeLabel(range)}
          </p>
        </div>
        <SyncStatusBadge status={syncStatusQuery.data} onSynced={handleSynced} />
      </div>

      <div className="mb-6">
        <FilterBar
          activePreset={preset}
          onPresetChange={(label, r) => {
            setPreset(label);
            setRange(r);
          }}
          businessUnit={businessUnit}
          onBusinessUnitChange={setBusinessUnit}
        />
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label="Manpower today"
          value={summary?.manpower.today ?? '—'}
          unit="on site"
          accent="var(--series-1)"
        />
        <StatCard
          label="Completed today"
          value={summary?.production.completedToday ?? '—'}
          unit="MT"
          accent="var(--series-3)"
          hint="Final-coat completions"
        />
        <StatCard
          label="Completed this month"
          value={summary?.production.completedMonth ?? '—'}
          unit="MT"
          accent="var(--series-3)"
          hint="Final-coat completions"
        />
        <StatCard
          label="Completed last month"
          value={summary?.production.completedLastMonth ?? '—'}
          unit="MT"
          accent="var(--series-3)"
          hint="Final-coat completions"
        />
      </motion.div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label="Dispatched today"
          value={summary?.dispatch.today ?? '—'}
          unit="MT"
          accent="var(--series-2)"
        />
        <StatCard
          label="Dispatched this month"
          value={summary?.dispatch.month ?? '—'}
          unit="MT"
          accent="var(--series-2)"
        />
        <StatCard
          label="Dispatched last month"
          value={summary?.dispatch.lastMonth ?? '—'}
          unit="MT"
          accent="var(--series-2)"
        />
        <StatCard
          label="Pending dispatch"
          value={totalPending ?? '—'}
          unit="MT"
          accent="var(--status-warning)"
          hint="Finished but not yet shipped, all clients"
        />
      </motion.div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summary && (
          <>
            <ProductionTrendChart trend={summary.production.trend} />
            <DispatchTrendChart trend={summary.dispatch.trend} />
            <ProductionStageChart byStage={summary.production.byStage} />
            <ProductionClientChart byClient={summary.production.byClient} />
            <DispatchClientChart byClient={summary.dispatch.byClient} />
            <PendingByClientChart pending={summary.pending} />
            <ManpowerTrendChart trend={summary.manpower.trend} />
            <ManpowerCategoryChart byCategory={summary.manpower.byCategory} />
            <TargetPanel targets={summary.targets} knownClients={knownClients} isAdmin={user?.role === 'admin'} />
          </>
        )}
      </div>

      {summaryQuery.isLoading && (
        <div className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading dashboard…
        </div>
      )}
    </div>
  );
}
