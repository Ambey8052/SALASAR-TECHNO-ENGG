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
      <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
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
      </div>

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
    </div>
  );
}
