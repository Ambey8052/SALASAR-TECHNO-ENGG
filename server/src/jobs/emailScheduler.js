import cron from 'node-cron';
import { ScheduledEmail } from '../models/ScheduledEmail.js';
import { sendReportEmail } from '../services/mailer.service.js';

// A claim older than this belongs to a tick whose process died mid-send.
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// Gmail answered and refused (rate limit, server error): the message was not accepted, so trying
// again later cannot send it twice. Anything else — a dropped connection, a timeout — leaves it
// unknown whether Gmail sent it, and is not retried.
function isSafeToRetry(err) {
  const status = err?.response?.status ?? err?.code;
  return status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
}

// Mail to clients must go out at most once. Each email is claimed with one atomic
// pending → sending update before it is handed to Gmail, so a tick that overlaps a slow previous
// one, or a second server running this same scheduler (a deploy overlap, a laptop pointed at the
// production database), finds nothing left to claim. Before this, both simply read every
// 'pending' email and sent it (RELIABILITY_REPORT REL-04).
async function claimNextDueEmail() {
  return ScheduledEmail.findOneAndUpdate(
    { status: 'pending', sendAt: { $lte: new Date() } },
    { $set: { status: 'sending', claimedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { sendAt: 1 }, returnDocument: 'after' },
  );
}

// `send` is the Gmail sender in the app; the tests pass a stand-in.
export async function runDueScheduledEmails(send = sendReportEmail) {
  // A claim that never reached 'sent' or 'failed' means the process stopped mid-send. Whether
  // Gmail sent it cannot be known from here, so it is flagged for a person rather than resent.
  await ScheduledEmail.updateMany(
    { status: 'sending', claimedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } },
    { $set: { status: 'unknown', error: 'The server stopped while this email was being sent. Check the Sent folder before resending.' } },
  );

  for (let email = await claimNextDueEmail(); email; email = await claimNextDueEmail()) {
    try {
      await send({
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        html: email.bodyHtml,
      });
      email.status = 'sent';
      email.sentAt = new Date();
      email.error = null;
    } catch (err) {
      const retry = isSafeToRetry(err) && email.attempts < MAX_ATTEMPTS;
      email.status = retry ? 'pending' : 'failed';
      email.error = err.message;
      console.error(`[email-scheduler] ${retry ? 'will retry' : 'failed to send'} scheduled email:`, email._id.toString(), err.message);
    }
    // One failed email never stops the rest: every outcome is recorded and the loop moves on.
    try {
      await email.save();
    } catch (err) {
      console.error('[email-scheduler] could not record the outcome of', email._id.toString(), err.message);
    }
    // A retry goes back to 'pending' and would be claimed again at once; leave it to next tick.
    if (email.status === 'pending') break;
  }
}

export function startEmailSchedulerCron() {
  // Checked every minute — fine-grained enough that "send at 9:00" actually goes out close
  // to 9:00, without needing a dedicated timer per scheduled email.
  cron.schedule('* * * * *', () => {
    runDueScheduledEmails().catch((err) => console.error('[email-scheduler] tick failed:', err.message));
  });

  console.log('[email-scheduler] cron scheduled every minute');
}
