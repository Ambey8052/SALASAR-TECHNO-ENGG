import http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { initSocket } from './sockets/index.js';
import { startSyncCron } from './jobs/cron.js';

async function main() {
  await connectDb();

  const httpServer = http.createServer(app);
  initSocket(httpServer);
  startSyncCron();

  httpServer.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
