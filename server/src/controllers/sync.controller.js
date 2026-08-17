import { runSync } from '../services/sync.service.js';
import { SyncLog } from '../models/SyncLog.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { emitSyncCompleted } from '../sockets/index.js';
import { DriveNotConnectedError } from '../services/googleSheets.service.js';

export async function triggerManualSync(req, res) {
  try {
    const log = await runSync('manual');
    emitSyncCompleted(log);
    res.json(log);
  } catch (err) {
    if (err instanceof DriveNotConnectedError) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
}

export async function getSyncStatus(req, res) {
  const [latestLog, tokenDoc] = await Promise.all([
    SyncLog.findOne().sort({ startedAt: -1 }),
    GoogleToken.findOne({ purpose: 'drive-sync' }),
  ]);

  res.json({
    driveConnected: Boolean(tokenDoc),
    connectedByEmail: tokenDoc?.connectedByEmail ?? null,
    latestSync: latestLog,
  });
}
