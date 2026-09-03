import { useState, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { fetchHsdSummary, fetchSyncStatus } from '../lib/api';
import { FilterBar, PRESETS, formatRangeLabel } from '../components/dashboard/FilterBar';
import { StatCard } from '../components/dashboard/StatCard';
import { ManpowerTrendChart, ManpowerCategoryChart } from '../components/dashboard/ManpowerChart';
import { ProductionTrendChart, ProductionStageChart } from '../components/dashboard/ProductionChart';
import { DispatchTrendChart, DispatchClientChart } from '../components/dashboard/DispatchChart';
import { InsightsPanel } from '../components/dashboard/InsightsPanel';
import { SyncStatusBadge } from '../components/dashboard/SyncStatusBadge';
import { useSyncSocket } from '../hooks/useSyncSocket';
import { useAuth } from '../context/AuthContext';
import { PC_HSD_EMAIL } from '../lib/constants';

const UNIT_LABEL = { HSD: 'HSD', BU: 'Bhilai' };

export function Dashboard() {
  const [preset, setPreset] = useState('Month to date');
  const [range, setRange] = useState(PRESETS[3].getRange());
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
    // The numbers stay exactly as first loaded for the whole session, for every role —
    // admin included. Neither background cron syncs nor a manually triggered "Sync now"
    // change what's on screen; only a fresh sign-in loads a new snapshot (AuthContext
    // clears this cache on logout). "Sync now" still updates the database underneath, an
    // admin just won't see the result until they sign back in.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const syncStatusQuery = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 60_000,
  });

  const handleSynced = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  }, [queryClient]);

  useSyncSocket(handleSynced);

  const summary = summaryQuery.data;
  const productionAvailable = summary?.production?.available ?? false;

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
        {user?.email !== PC_HSD_EMAIL && <SyncStatusBadge status={syncStatusQuery.data} onSynced={handleSynced} />}
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
        Snapshot — fixed, ignores the filter above
      </div>
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        className="mb-6 grid grid-cols-2 gap-4"
      >
        <StatCard
          label="Manpower today"
          value={summary?.manpower.today ?? '—'}
          unit="on site"
          accent="var(--series-1)"
        />
        {summary?.dispatch?.available && (
          <StatCard
            label={
              summary.dispatch.lastRecordedDay?.date
                ? `Dispatched (${format(new Date(summary.dispatch.lastRecordedDay.date), 'd MMM')})`
                : 'Dispatched'
            }
            value={summary?.dispatch.lastRecordedDay?.total ?? '—'}
            unit="MT"
            accent="var(--series-2)"
            hint="Last day with recorded dispatch"
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
            className="mb-6 grid grid-cols-2 gap-4"
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summary && (
          <>
            <ManpowerCategoryChart byCategory={summary.manpower.byCategory} />
            <ManpowerTrendChart trendByCategory={summary.manpower.trendByCategory} />
            {productionAvailable && (
              <>
                <ProductionStageChart byStageByClient={summary.production.byStageByClient} />
                <ProductionTrendChart trendByClient={summary.production.trendByClient} byClient={summary.production.byClient} />
                <DispatchClientChart byClient={summary.dispatch.byClient} />
                <DispatchTrendChart trendByClient={summary.dispatch.trendByClient} byClient={summary.dispatch.byClient} />
              </>
            )}
          </>
        )}
      </div>

      {summary && (
        <div className="mt-4">
          <InsightsPanel params={params} />
        </div>
      )}

      {summaryQuery.isLoading && (
        <div className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading dashboard…
        </div>
      )}
    </div>
  );
}
