import nodemailer from 'nodemailer';
import dns from 'dns/promises';
import { env } from '../config/env.js';

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
// Two different failure modes have shown up in production (Render), each ruling out a
// different assumption:
//  1. ENETUNREACH on an IPv6 address — nodemailer's own DNS resolution (independent of any
//     transport option, or even Node's dns.setDefaultResultOrder) resolves both address
//     families and picks a random one; fixed by resolving IPv4 ourselves and connecting to
//     that literal IP so nodemailer has no hostname left to resolve.
//  2. Connection timeout on the correctly-resolved IPv4 address, port 465 — Render silently
//     drops the connection rather than refusing it, which is the signature of an egress
//     firewall blocking that specific port (465, and 587 blocks the same way on some hosts).
// So this tries every combination of (IPv4 address × port/security mode) and keeps whichever
// one actually completes a real handshake, instead of betting on a single guess.
const CANDIDATE_PORTS = [
  { port: 465, secure: true }, // implicit TLS
  { port: 587, secure: false }, // STARTTLS
];

async function resolveGmailIPv4Addresses() {
  // dns.lookup (the OS resolver, getaddrinfo) rather than dns.resolve4 (a raw DNS query against
  // a configured nameserver) — the latter doesn't work in every environment (it's blocked
  // outright in some sandboxed/corporate networks), while dns.lookup is the same broadly
  // portable path a normal hostname connection would use, just constrained to IPv4 only.
  const results = await dns.lookup(GMAIL_SMTP_HOST, { family: 4, all: true });
  return results.map((r) => r.address);
}

function buildTransport(host, { port, secure }) {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure, // STARTTLS on 587 must actually upgrade, never send auth in the clear
    tls: { servername: GMAIL_SMTP_HOST }, // keep cert verification pinned to the real hostname
    auth: { user: env.emailUser, pass: env.emailAppPassword },
    // Without explicit timeouts, a stalled connection (common right after a free-tier Render
    // instance wakes from sleep, before outbound networking is fully up, or when a port is
    // silently firewalled) hangs until the client's own axios timeout gives up — a generic
    // error with no cause. These make each candidate fail fast so probing stays quick.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    // Pooling keeps the connection (and its TLS/auth handshake) open between sends instead of
    // paying that cost every time — a real speedup for back-to-back sends in the same warm
    // process. The first send after a cold start still pays it once.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  });
}

export class MailerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailerUnavailableError';
  }
}

let transporterPromise = null;
async function probeTransporter() {
  const addresses = await resolveGmailIPv4Addresses();
  const attempts = [];
  for (const host of addresses) {
    for (const candidate of CANDIDATE_PORTS) {
      attempts.push({ host, ...candidate });
    }
  }

  const errors = [];
  for (const { host, port, secure } of attempts) {
    const candidate = buildTransport(host, { port, secure });
    try {
      await candidate.verify(); // actually opens the connection and authenticates
      console.log(`[mailer] connected via ${host}:${port} (${secure ? 'TLS' : 'STARTTLS'})`);
      return candidate;
    } catch (err) {
      candidate.close();
      errors.push(`${host}:${port} — ${err.message}`);
    }
  }

  throw new Error(`Could not reach Gmail SMTP on any address/port. Tried:\n${errors.join('\n')}`);
}

function getTransporter() {
  if (!env.emailUser || !env.emailAppPassword) return null;
  if (!transporterPromise) {
    transporterPromise = probeTransporter().catch((err) => {
      transporterPromise = null; // let the next send retry the whole probe
      throw err;
    });
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
