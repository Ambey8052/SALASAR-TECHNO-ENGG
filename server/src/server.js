import http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { initSocket } from './sockets/index.js';
import { startSyncCron } from './jobs/cron.js';
import { startEmailSchedulerCron } from './jobs/emailScheduler.js';
import { startKeepAliveCron } from './jobs/keepAlive.js';

// Node's default for an unhandled rejection is to terminate the process, which would stop the
// sync cron and the email scheduler along with the API. Every route is wrapped
// (utils/asyncHandler.js) and every cron catches its own errors; this is the backstop for
// anything that still slips through — logged loudly, but the server keeps serving.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
});

async function main() {
  await connectDb();

  const httpServer = http.createServer(app);
  initSocket(httpServer);
  startSyncCron();
  startEmailSchedulerCron();
  startKeepAliveCron();

  httpServer.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
