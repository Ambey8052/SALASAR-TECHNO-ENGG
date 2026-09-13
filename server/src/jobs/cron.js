import cron from 'node-cron';
import { runSync, SyncInProgressError } from '../services/sync.service.js';
import { emitSyncCompleted } from '../sockets/index.js';
import { env } from '../config/env.js';

export function startSyncCron() {
  const everyNMinutes = `*/${env.syncIntervalMinutes} * * * *`;

  cron.schedule(everyNMinutes, async () => {
    try {
      const log = await runSync('cron');
      emitSyncCompleted(log);
      console.log(`[sync] cron sync ${log.status}, ${log.rowsUpserted} rows upserted`);
    } catch (err) {
      // Another run holds the lock — a slow previous tick, a manual "Sync now", or a second
      // process. Skipping is the point of the lock.
      if (err instanceof SyncInProgressError) {
        console.log('[sync] cron tick skipped: a sync is already running');
      } else {
        console.error('[sync] cron sync failed:', err.message);
      }
    }
  });

  console.log(`[sync] cron scheduled every ${env.syncIntervalMinutes} minute(s)`);
}
