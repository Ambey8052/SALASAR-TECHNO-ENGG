import nodemailer from 'nodemailer';
import dns from 'dns/promises';
import { env } from '../config/env.js';

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 465;

// Neither the transporter's `family: 4` option nor process-wide dns.setDefaultResultOrder
// stopped Render from attempting an IPv6 connection to Gmail (ENETUNREACH — Render's outbound
// IPv6 routing doesn't reach it). Reading nodemailer's own source explains why: its SMTP
// connection module does its own DNS resolution independent of Node's settings — it resolves
// *both* the IPv4 and IPv6 addresses and then picks a **random** one from the combined list.
// No transport option can override that. The only reliable fix is to not let it resolve the
// hostname at all: nodemailer only does its own lookup when `host` isn't already a literal IP,
// so resolving the IPv4 address ourselves and connecting to that IP directly skips it entirely.
// `tls.servername` keeps TLS certificate verification (and SNI) checking against the real
// hostname rather than the bare IP.
async function resolveGmailIPv4() {
  // dns.lookup (the OS resolver, getaddrinfo) rather than dns.resolve4 (a raw DNS query against
  // a configured nameserver) — the latter doesn't work in every environment (it's blocked
  // outright in some sandboxed/corporate networks), while dns.lookup is the same broadly
  // portable path a normal hostname connection would use, just constrained to IPv4 only.
  const { address } = await dns.lookup(GMAIL_SMTP_HOST, { family: 4 });
  return address;
}

export class MailerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailerUnavailableError';
  }
}

let transporterPromise = null;
function getTransporter() {
  if (!env.emailUser || !env.emailAppPassword) return null;
  if (!transporterPromise) {
    transporterPromise = resolveGmailIPv4().then(
      (ip) =>
        nodemailer.createTransport({
          host: ip,
          port: GMAIL_SMTP_PORT,
          secure: true,
          tls: { servername: GMAIL_SMTP_HOST },
          auth: { user: env.emailUser, pass: env.emailAppPassword },
          // Without explicit timeouts, a stalled connection (common right after a free-tier
          // Render instance wakes from sleep, before outbound networking is fully up) hangs
          // until the client's own axios timeout gives up — a generic error with no cause.
          // These make it fail fast with a clear reason instead.
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 20_000,
          // Pooling keeps the connection (and its TLS/auth handshake) open between sends
          // instead of paying that cost every time — a real speedup for back-to-back sends
          // in the same warm process. The first send after a cold start still pays it once.
          pool: true,
          maxConnections: 1,
          maxMessages: 50,
        }),
      (err) => {
        transporterPromise = null; // let the next send retry the DNS resolution
        throw err;
      },
    );
  }
  return transporterPromise;
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
  const transporterOrNull = getTransporter();
  if (!transporterOrNull) throw new MailerUnavailableError('Email sending is not configured on the server.');
  const client = await transporterOrNull;

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
