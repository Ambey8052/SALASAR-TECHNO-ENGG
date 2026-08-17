import cron from 'node-cron';
import { runSync } from '../services/sync.service.js';
import { emitSyncCompleted } from '../sockets/index.js';
import { env } from '../config/env.js';
import { DriveNotConnectedError } from '../services/googleSheets.service.js';

export function startSyncCron() {
  const everyNMinutes = `*/${env.syncIntervalMinutes} * * * *`;

  cron.schedule(everyNMinutes, async () => {
    try {
      const log = await runSync('cron');
      emitSyncCompleted(log);
      console.log(`[sync] cron sync ${log.status}, ${log.rowsUpserted} rows upserted`);
    } catch (err) {
      if (err instanceof DriveNotConnectedError) {
        console.log('[sync] skipped: Drive not connected yet');
      } else {
        console.error('[sync] cron sync failed:', err.message);
      }
    }
  });

  console.log(`[sync] cron scheduled every ${env.syncIntervalMinutes} minute(s)`);
}
