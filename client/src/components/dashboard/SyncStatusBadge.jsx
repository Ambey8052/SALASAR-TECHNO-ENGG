import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { triggerSync, API_BASE } from '../../lib/api';

const STATUS_COLOR = {
  success: 'var(--status-good)',
  partial: 'var(--status-warning)',
  failed: 'var(--status-critical)',
  running: 'var(--text-muted)',
};

export function SyncStatusBadge({ status, onSynced }) {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!status) return null;

  if (!status.driveConnected) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{ color: 'var(--status-warning)' }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-warning)' }} />
        Drive not connected
        {user?.role === 'admin' && (
          <a href={`${API_BASE}/api/auth/google/connect-drive`} className="ml-1 underline">
            Connect
          </a>
        )}
      </div>
    );
  }

  const log = status.latestSync;
  const dotColor = STATUS_COLOR[log?.status] || 'var(--text-muted)';
  const issues = log?.issues ?? [];
  const synopsisTabs = (log?.tabsProcessed ?? []).filter((tab) => tab.startsWith('Synopsis/'));

  async function handleSyncNow() {
    setSyncing(true);
    setError(null);
    try {
      await triggerSync();
      onSynced?.();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        setError('Your session is out of date. Sign out and sign back in, then try again.');
      } else {
        setError(err?.response?.data?.error || 'Sync failed. Please try again.');
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="relative flex items-center gap-3">
      {/* The dot alone can only say "something was wrong", never what. Opening the badge shows
          the run's own log, so an empty dashboard can be traced to the step that failed
          without going to the database for it. */}
      <button
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        title="Show what the last sync did"
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={syncing ? 'syncing' : dotColor}
            className="h-2 w-2 rounded-full"
            style={{ background: syncing ? 'var(--series-1)' : dotColor }}
            animate={syncing ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
            transition={syncing ? { repeat: Infinity, duration: 1 } : {}}
          />
        </AnimatePresence>
        {log?.finishedAt
          ? `Synced ${formatDistanceToNow(new Date(log.finishedAt), { addSuffix: true })}`
          : 'Awaiting first sync'}
        {issues.length > 0 && (
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--status-warning)', color: '#ffffff' }}>
            {issues.length}
          </span>
        )}
      </button>

      {user?.role === 'admin' && (
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleSyncNow}
          disabled={syncing}
          className="rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </motion.button>
      )}

      {error && (
        <div
          className="absolute top-full right-0 mt-2 max-w-xs rounded-lg border px-3 py-2 text-xs shadow-md"
          style={{ background: 'var(--surface-2)', color: 'var(--status-critical)' }}
        >
          {error}
        </div>
      )}

      {detailsOpen && log && (
        <div
          className="absolute top-full right-0 z-30 mt-2 w-80 rounded-xl border p-3 text-xs shadow-lg"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>
              {log.status} — {log.trigger} sync
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{log.rowsUpserted} rows</span>
          </div>

          <div className="mb-2" style={{ color: 'var(--text-secondary)' }}>
            {synopsisTabs.length > 0
              ? `Dispatch Synopsis: read ${synopsisTabs.length} month${synopsisTabs.length === 1 ? '' : 's'} (${synopsisTabs
                  .map((t) => t.replace('Synopsis/', ''))
                  .join(', ')}).`
              : 'Dispatch Synopsis: no monthly workbooks were read in this run.'}
          </div>

          {issues.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No issues reported.</div>
          ) : (
            <ul className="max-h-56 space-y-1.5 overflow-auto">
              {issues.map((issue, i) => (
                <li key={`${issue.tab}-${i}`} style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--status-warning)' }}>
                    {issue.tab}
                  </span>
                  : {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
