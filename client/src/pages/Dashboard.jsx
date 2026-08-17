import { useState, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { fetchHsdSummary, fetchSyncStatus } from '../lib/api';
import { FilterBar, PRESETS, formatRangeLabel } from '../components/dashboard/FilterBar';
import { StatCard } from '../components/dashboard/StatCard';
import { useAuth } from '../context/AuthContext';
import { ManpowerTrendChart, ManpowerCategoryChart } from '../components/dashboard/ManpowerChart';
import { ProductionTrendChart, ProductionStageChart, ProductionClientChart } from '../components/dashboard/ProductionChart';
import { DispatchTrendChart, DispatchClientChart } from '../components/dashboard/DispatchChart';
import { TargetPanel } from '../components/dashboard/TargetPanel';
import { InsightsPanel } from '../components/dashboard/InsightsPanel';
import { SyncStatusBadge } from '../components/dashboard/SyncStatusBadge';
import { useSyncSocket } from '../hooks/useSyncSocket';

const UNIT_LABEL = { HSD: 'HSD', BU: 'Bhilai' };

export function Dashboard() {
  const [preset, setPreset] = useState('Last 30 days');
  const [range, setRange] = useState(PRESETS[2].getRange());
  const [businessUnit, setBusinessUnit] = useState('HSD');
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const params = {
    from: format(range.from, 'yyyy-MM-dd'),
    to: format(range.to, 'yyyy-MM-dd'),
    businessUnit,
  };

  const summaryQuery = useQuery({
    queryKey: ['hsd-summary', params],
    queryFn: () => fetchHsdSummary(params),
    placeholderData: keepPreviousData,
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
  const productionAvailable = summary?.production?.available ?? false;
  const knownClients = summary?.production?.byClient.map((c) => c.client) ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {UNIT_LABEL[businessUnit]} Overview
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
          range={range}
          onPresetChange={(label, r) => {
            setPreset(label);
            setRange(r);
          }}
          businessUnit={businessUnit}
          onBusinessUnitChange={setBusinessUnit}
        />
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        Today — fixed, ignores the filter above
      </div>
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <StatCard
          label="Manpower today"
          value={summary?.manpower.today ?? '—'}
          unit="on site"
          accent="var(--series-1)"
        />
        {productionAvailable && (
          <StatCard
            label="Completed today"
            value={summary?.production.completedToday ?? '—'}
            unit="MT"
            accent="var(--series-3)"
            hint="Final-coat completions"
          />
        )}
        {summary?.dispatch?.available && (
          <StatCard
            label="Dispatched today"
            value={summary?.dispatch.today ?? '—'}
            unit="MT"
            accent="var(--series-2)"
          />
        )}
      </motion.div>

      {summary && !productionAvailable && (
        <div className="mb-6 rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
          Production and dispatch tracking for Bhilai isn't connected to a data source yet — only manpower is available for this unit right now.
        </div>
      )}

      {productionAvailable && (
        <>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {formatRangeLabel(range)} — follows the filter above
          </div>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <StatCard
              label={`Completed (${preset})`}
              value={summary?.production.completedInRange ?? '—'}
              unit="MT"
              accent="var(--series-3)"
              hint="Final-coat completions in the selected range"
            />
            <StatCard
              label={`Dispatched (${preset})`}
              value={summary?.dispatch.inRange ?? '—'}
              unit="MT"
              accent="var(--series-2)"
              hint="Dispatched in the selected range"
            />
          </motion.div>
        </>
      )}

      <div className="mb-4">
        <InsightsPanel params={params} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summary && (
          <>
            {productionAvailable && (
              <>
                <ProductionTrendChart trend={summary.production.trend} />
                <DispatchTrendChart trendByClient={summary.dispatch.trendByClient} byClient={summary.dispatch.byClient} />
                <ProductionStageChart byStage={summary.production.byStage} />
                <ProductionClientChart byClient={summary.production.byClient} />
                <DispatchClientChart byClient={summary.dispatch.byClient} />
              </>
            )}
            <ManpowerTrendChart trend={summary.manpower.trend} />
            <ManpowerCategoryChart byCategory={summary.manpower.byCategory} />
            {productionAvailable && (
              <TargetPanel targets={summary.targets} knownClients={knownClients} isAdmin={user?.role === 'admin'} />
            )}
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
