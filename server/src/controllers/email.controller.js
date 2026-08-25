import { env } from '../config/env.js';
import { sendReportEmail, MailerUnavailableError } from '../services/mailer.service.js';
import { ScheduledEmail } from '../models/ScheduledEmail.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRecipients(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v && EMAIL_PATTERN.test(v));
}

function validateComposedEmail(body) {
  const { to, cc, subject, bodyHtml } = body;
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);

  if (toList.length === 0) return { error: 'At least one valid "To" recipient is required.' };
  if (!subject || !subject.trim()) return { error: 'Subject is required.' };
  if (!bodyHtml || !bodyHtml.trim()) return { error: 'Email body is required.' };

  return { toList, ccList, subject: subject.trim(), bodyHtml };
}

export async function sendReport(req, res) {
  const validated = validateComposedEmail(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { toList, ccList, subject, bodyHtml } = validated;

  try {
    await sendReportEmail({ from: env.emailUser, to: toList, cc: ccList, subject, html: bodyHtml });
    res.json({ ok: true, to: toList, cc: ccList });
  } catch (err) {
    if (err instanceof MailerUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[email] send failed:', err.message);
    res.status(502).json({ error: 'Failed to send email. Please try again.' });
  }
}

export async function scheduleReport(req, res) {
  const validated = validateComposedEmail(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { toList, ccList, subject, bodyHtml } = validated;

  const sendAt = new Date(req.body.sendAt);
  if (Number.isNaN(sendAt.getTime())) {
    return res.status(400).json({ error: 'A valid send date/time is required.' });
  }
  if (sendAt.getTime() < Date.now() + 60_000) {
    return res.status(400).json({ error: 'Scheduled time must be at least a minute in the future.' });
  }

  const scheduled = await ScheduledEmail.create({
    from: env.emailUser,
    to: toList,
    cc: ccList,
    subject,
    bodyHtml,
    sendAt,
    createdByEmail: req.user.email,
  });

  res.json({ ok: true, id: scheduled._id, sendAt: scheduled.sendAt });
}

export async function listScheduledEmails(req, res) {
  const scheduled = await ScheduledEmail.find({ createdByEmail: req.user.email, status: 'pending' })
    .sort({ sendAt: 1 })
    .lean();
  res.json(
    scheduled.map((s) => ({
      id: s._id,
      to: s.to,
      cc: s.cc,
      subject: s.subject,
      sendAt: s.sendAt,
    })),
  );
}

export async function cancelScheduledEmail(req, res) {
  const scheduled = await ScheduledEmail.findOne({ _id: req.params.id, createdByEmail: req.user.email });
  if (!scheduled) return res.status(404).json({ error: 'Scheduled email not found.' });
  if (scheduled.status !== 'pending') {
    return res.status(409).json({ error: 'This email has already been sent or cancelled.' });
  }
  scheduled.status = 'cancelled';
  await scheduled.save();
  res.json({ ok: true });
}
