import { useState, useCallback, useRef } from 'react';
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
import { SynopsisView } from '../components/dashboard/SynopsisView';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import { useSyncSocket } from '../hooks/useSyncSocket';
import { useAuth } from '../context/AuthContext';
import { PC_HSD_EMAIL } from '../lib/constants';

const UNIT_LABEL = { HSD: 'HSD', BU: 'Bhilai' };

const VIEWS = [
  { value: 'overview', label: 'Production Synopsis' },
  { value: 'synopsis', label: 'Dispatch Synopsis' },
];

function ViewToggle({ view, onChange }) {
  return (
    <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--surface-2)' }}>
      {VIEWS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={view === option.value}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            background: view === option.value ? 'var(--series-1)' : 'transparent',
            color: view === option.value ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [view, setView] = useState('overview');
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

  // The figures on screen are deliberately frozen for the session (above), while the sync badge
  // updates live. Side by side, "Synced 2 minutes ago" read as "these numbers are two minutes
  // old" when they could be hours old. The page now says which sync its figures came from, and
  // offers — never forces — newer ones when a sync lands.
  const [newerDataAvailable, setNewerDataAvailable] = useState(false);
  const dataAsOfRef = useRef(null);
  const summary = summaryQuery.data;
  dataAsOfRef.current = summary?.dataAsOf ?? null;

  const handleSynced = useCallback(
    (event) => {
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
      const wroteData = !event || event.status === 'success' || event.status === 'partial';
      const newer = !event?.finishedAt || !dataAsOfRef.current || new Date(event.finishedAt) > new Date(dataAsOfRef.current);
      if (wroteData && newer) setNewerDataAvailable(true);
    },
    [queryClient],
  );

  useSyncSocket(handleSynced);

  function loadNewerFigures() {
    setNewerDataAvailable(false);
    queryClient.invalidateQueries({ queryKey: ['hsd-summary'] });
    queryClient.invalidateQueries({ queryKey: ['synopsis'] });
    queryClient.invalidateQueries({ queryKey: ['hsd-insights'] });
  }

  const productionAvailable = summary?.production?.available ?? false;
  const dispatchAvailable = summary?.dispatch?.available ?? false;
  const isSynopsis = view === 'synopsis';

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isSynopsis ? 'Dispatch Synopsis' : `${UNIT_LABEL[businessUnit]} Production Synopsis`}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isSynopsis ? 'Department-wise dispatch against plan, from the monthly synopsis reports' : formatRangeLabel(range)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          {user?.email !== PC_HSD_EMAIL && <SyncStatusBadge status={syncStatusQuery.data} onSynced={() => handleSynced()} />}
        </div>
      </div>

      {newerDataAvailable && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm"
          style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
        >
          <span>Newer figures are available from the latest sync. The numbers below are unchanged until you refresh.</span>
          <button onClick={loadNewerFigures} className="rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--series-1)', color: '#ffffff' }}>
            Refresh figures
          </button>
        </div>
      )}

      {isSynopsis && <SynopsisView />}

      {!isSynopsis && summaryQuery.isError && !summary && (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--status-critical)', background: 'var(--surface-1)' }}>
          The dashboard figures could not be loaded. {summaryQuery.error?.response?.data?.error || 'Check your connection and reload the page.'}
        </div>
      )}

      {!isSynopsis && (
        <>
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

          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Snapshot &amp; {formatRangeLabel(range)}
            </span>
            {summary && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }} title="The figures on this page stay as loaded until you refresh them.">
                {summary.dataAsOf
                  ? `Figures as of the ${format(new Date(summary.dataAsOf), 'd MMM, HH:mm')} sync`
                  : 'No completed sync yet'}
              </span>
            )}
          </div>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            className="mb-6 flex items-stretch gap-3 overflow-x-auto"
          >
            <StatCard
              compact
              label="Manpower today"
              value={summary?.manpower.today ?? '—'}
              unit="on site"
              accent="var(--series-1)"
            />
            {summary?.dispatch?.available && (
              <StatCard
                compact
                label={
                  summary.dispatch.lastRecordedDay?.date
                    ? `Dispatched (${format(new Date(summary.dispatch.lastRecordedDay.date), 'd MMM')})`
                    : 'Dispatched'
                }
                value={summary?.dispatch.lastRecordedDay?.total ?? '—'}
                unit="MT"
                accent="var(--series-2)"
              />
            )}
            {productionAvailable && (
              <StatCard
                compact
                wrapLabel
                label="Completed production till final coat"
                value={summary?.production.completedInRange ?? '—'}
                unit="MT"
                accent="var(--series-3)"
              />
            )}
            {dispatchAvailable && (
              <StatCard
                compact
                label={`Dispatched (${preset === 'Custom' ? formatRangeLabel(range) : preset})`}
                value={summary?.dispatch.inRange ?? '—'}
                unit="MT"
                accent="var(--series-2)"
              />
            )}
          </motion.div>

          {summary && !productionAvailable && (
            <div className="mb-6 rounded-xl border px-4 py-3 text-sm" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
              Production tracking for Bhilai isn't connected to a data source yet — manpower and dispatch are shown for this unit.
            </div>
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
                  </>
                )}
                {dispatchAvailable && (
                  <>
                    <DispatchClientChart byClient={summary.dispatch.byClient} />
                    <DispatchTrendChart trendByClient={summary.dispatch.trendByClient} byClient={summary.dispatch.byClient} />
                  </>
                )}
              </>
            )}
          </div>

          {summary && (
            <div className="mt-4">
              {/* A broken panel must never take the whole dashboard down with it. */}
              <ErrorBoundary fallback={null}>
                <InsightsPanel params={params} />
              </ErrorBoundary>
            </div>
          )}

          {summaryQuery.isLoading && (
            <div className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading dashboard…
            </div>
          )}
        </>
      )}
    </div>
  );
}
