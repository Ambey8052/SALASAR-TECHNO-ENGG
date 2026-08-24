import { env } from '../config/env.js';
import { sendReportEmail, MailerUnavailableError } from '../services/mailer.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRecipients(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v && EMAIL_PATTERN.test(v));
}

export async function sendReport(req, res) {
  const { to, cc, subject, bodyHtml } = req.body;

  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);

  if (toList.length === 0) {
    return res.status(400).json({ error: 'At least one valid "To" recipient is required.' });
  }
  if (!subject || !subject.trim()) {
    return res.status(400).json({ error: 'Subject is required.' });
  }
  if (!bodyHtml || !bodyHtml.trim()) {
    return res.status(400).json({ error: 'Email body is required.' });
  }

  try {
    await sendReportEmail({
      from: env.emailUser,
      to: toList,
      cc: ccList,
      subject: subject.trim(),
      html: bodyHtml,
    });
    res.json({ ok: true, to: toList, cc: ccList });
  } catch (err) {
    if (err instanceof MailerUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[email] send failed:', err.message);
    res.status(502).json({ error: 'Failed to send email. Please try again.' });
  }
}
