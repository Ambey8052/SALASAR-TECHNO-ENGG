import { runSync, SyncInProgressError } from '../services/sync.service.js';
import { SyncLog } from '../models/SyncLog.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { emitSyncCompleted } from '../sockets/index.js';

export async function triggerManualSync(req, res) {
  try {
    const log = await runSync('manual');
    emitSyncCompleted(log);
    res.json(log);
  } catch (err) {
    if (err instanceof SyncInProgressError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[sync] manual sync failed:', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
}

export async function getSyncStatus(req, res) {
  const [latestLog, lastGoodLog, tokenDoc] = await Promise.all([
    SyncLog.findOne().sort({ startedAt: -1 }),
    // The run whose data the dashboard is showing: the newest one that wrote anything.
    SyncLog.findOne({ status: { $in: ['success', 'partial'] } }).sort({ startedAt: -1 }).select('finishedAt status'),
    GoogleToken.findOne({ purpose: 'drive-sync' }),
  ]);

  res.json({
    driveConnected: Boolean(tokenDoc),
    // Who connected Drive is an admin concern; every manager polls this endpoint.
    connectedByEmail: req.user.role === 'admin' ? tokenDoc?.connectedByEmail ?? null : null,
    latestSync: latestLog,
    lastSuccessfulSyncAt: lastGoodLog?.finishedAt ?? null,
  });
}
