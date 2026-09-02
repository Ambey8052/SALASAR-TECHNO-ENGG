import cron from 'node-cron';
import { env } from '../config/env.js';

// Render's free tier spins a web service down after ~15 minutes with no inbound HTTP
// traffic, then pays a 30-60s cold start on the next request — which is what made email
// sending (and anything else) feel "slow", and silently starved the email-scheduler cron
// entirely if the service was asleep at the scheduled send time. A request to our own public
// URL travels out through Render's edge and back in as real inbound traffic, so it counts
// the same as a visitor hitting the site — this is a standard, widely-used workaround for
// free-tier spin-down (the same thing an external uptime pinger like UptimeRobot would do).
export function startKeepAliveCron() {
  if (!env.publicUrl) {
    console.log('[keep-alive] no RENDER_EXTERNAL_URL set — skipping (not needed outside Render)');
    return;
  }

  cron.schedule('*/10 * * * *', async () => {
    try {
      await fetch(`${env.publicUrl}/api/health`);
    } catch (err) {
      console.error('[keep-alive] self-ping failed:', err.message);
    }
  });

  console.log('[keep-alive] self-ping scheduled every 10 minutes');
}
