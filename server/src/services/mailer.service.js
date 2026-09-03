import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { createGmailOAuthClient } from '../config/google.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { decryptText } from '../utils/crypto.js';

// SMTP is not usable from this host: every combination of Gmail's SMTP IPv4 addresses and
// both standard ports (465, 587) times out — Render's outbound network blocks SMTP entirely
// for this plan, confirmed by direct testing. Sending goes over the Gmail API instead (plain
// HTTPS to gmail.googleapis.com), a port that's never blocked. This needs its own OAuth grant
// from pc.hsd@salasartechno.com (see redirectToGmailConnect in auth.controller.js) rather than
// the app password, which only worked for SMTP auth and has no bearing on the API.
export class MailerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailerUnavailableError';
  }
}

async function getGmailClient() {
  const tokenDoc = await GoogleToken.findOne({ purpose: 'gmail-send' });
  if (!tokenDoc) return null;

  const client = createGmailOAuthClient();
  client.setCredentials({ refresh_token: decryptText(tokenDoc.encryptedRefreshToken) });
  return google.gmail({ version: 'v1', auth: client });
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

// MailComposer (nodemailer's MIME builder, used here purely for composition — nothing is sent
// over SMTP) produces the exact RFC 2822 message the Gmail API's messages.send expects as its
// base64url-encoded `raw` field.
function buildRawMessage(mail) {
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    });
  });
}

export async function sendReportEmail({ from, to, cc, subject, html, attachments = [] }) {
  const gmail = await getGmailClient();
  if (!gmail) {
    throw new MailerUnavailableError(
      'Gmail sending is not connected yet. Visit /api/auth/google/connect-gmail signed in as pc.hsd@salasartechno.com.',
    );
  }

  const { html: finalHtml, attachments: inlineAttachments } = extractInlineImages(html);
  const raw = await buildRawMessage({
    from,
    to,
    cc: cc?.length ? cc : undefined,
    subject,
    html: finalHtml,
    attachments: [...inlineAttachments, ...attachments],
  });

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}
