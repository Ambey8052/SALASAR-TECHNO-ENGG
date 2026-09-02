import http from 'http';
import dns from 'dns';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { initSocket } from './sockets/index.js';
import { startSyncCron } from './jobs/cron.js';
import { startEmailSchedulerCron } from './jobs/emailScheduler.js';
import { startKeepAliveCron } from './jobs/keepAlive.js';

// The transporter's own `family: 4` option (mailer.service.js) wasn't enough — Gmail's SMTP
// host still got resolved to its IPv6 address (ENETUNREACH on Render, whose IPv6 egress
// doesn't route there), because that resolution happens through Node's own dns.lookup before
// nodemailer's option ever gets a say. This sets Node's default resolution order process-wide,
// which actually determines what address gets tried first.
dns.setDefaultResultOrder('ipv4first');

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
