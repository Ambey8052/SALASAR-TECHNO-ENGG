import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export class MailerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailerUnavailableError';
  }
}

let transporter = null;
function getTransporter() {
  if (!env.emailUser || !env.emailAppPassword) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.emailUser, pass: env.emailAppPassword },
    });
  }
  return transporter;
}

// Inline images are composed as data: URLs in the rich-text body (so they preview instantly
// while writing). Before sending, each one is pulled out into a proper CID attachment and the
// <img> tag is rewritten to reference it — that's the only way most mail clients render an
// inline image reliably, since they generally don't render base64 data: URLs at all.
export function extractInlineImages(html) {
  const attachments = [];
  let index = 0;

  const rewritten = html.replace(
    /<img([^>]*)\ssrc="data:image\/(png|jpe?g|gif|webp);base64,([^"]+)"([^>]*)>/gi,
    (match, before, ext, base64, after) => {
      const cid = `inline-${Date.now()}-${index}@salasar-hsd`;
      index += 1;
      attachments.push({
        filename: `image-${index}.${ext === 'jpg' ? 'jpeg' : ext}`,
        content: Buffer.from(base64, 'base64'),
        cid,
      });
      return `<img${before} src="cid:${cid}"${after}>`;
    },
  );

  return { html: rewritten, attachments };
}

export async function sendReportEmail({ from, to, cc, subject, html, attachments = [] }) {
  const client = getTransporter();
  if (!client) throw new MailerUnavailableError('Email sending is not configured on the server.');

  const { html: finalHtml, attachments: inlineAttachments } = extractInlineImages(html);

  await client.sendMail({
    from,
    to,
    cc: cc?.length ? cc : undefined,
    subject,
    html: finalHtml,
    attachments: [...inlineAttachments, ...attachments],
  });
}
