import cron from 'node-cron';
import { ScheduledEmail } from '../models/ScheduledEmail.js';
import { sendReportEmail } from '../services/mailer.service.js';

async function runDueScheduledEmails() {
  const due = await ScheduledEmail.find({ status: 'pending', sendAt: { $lte: new Date() } });

  for (const email of due) {
    try {
      await sendReportEmail({
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
      email.status = 'failed';
      email.error = err.message;
      console.error('[email-scheduler] failed to send scheduled email:', email._id.toString(), err.message);
    }
    await email.save();
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
