import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  createLoginOAuthClient,
  createDriveOAuthClient,
  createGmailOAuthClient,
  LOGIN_SCOPES,
  DRIVE_SYNC_SCOPES,
  GMAIL_SEND_SCOPES,
} from '../config/google.js';
import { env, isAllowedLogin, roleFor } from '../config/env.js';
import { User } from '../models/User.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { encryptText } from '../utils/crypto.js';

// Whether the cookie needs the cross-site (SameSite=None; Secure) shape or the simpler
// same-site (Lax) one. Driven by req.secure (reliable because app.js sets 'trust proxy')
// rather than NODE_ENV — Render doesn't guarantee that's set to 'production', and a wrong
// guess here means the cookie silently never gets sent back on cross-origin API calls,
// bouncing every login straight back to /login with no visible error.
function crossSiteCookieOptions(req) {
  const secure = req.secure;
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax' };
}

// OAuth `state`: a random value set in a short-lived cookie when a flow starts and required
// back, unchanged, on its callback. Without it, a callback URL carrying someone else's
// authorization code could be replayed against a signed-in user — signing them into another
// account, or (for an admin) storing an attacker's Drive grant as the sync credential, which
// silently breaks every sync from then on (SECURITY_REPORT SEC-03). SameSite=Lax is enough: the
// callback is a top-level navigation back from accounts.google.com, which Lax cookies accompany.
const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_PATH = '/api/auth';

function startOAuthFlow(req, res, flow) {
  const state = crypto.randomBytes(24).toString('base64url');
  res.cookie(STATE_COOKIE, `${flow}.${state}`, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: STATE_COOKIE_PATH,
  });
  return state;
}

function isValidOAuthState(req, res, flow) {
  const expected = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: STATE_COOKIE_PATH });
  const received = typeof req.query.state === 'string' ? `${flow}.${req.query.state}` : '';
  if (!expected || !received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function issueSessionCookie(req, res, user) {
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, name: user.name, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
  res.cookie('session', token, { ...crossSiteCookieOptions(req), maxAge: 12 * 60 * 60 * 1000 });
}

export function redirectToGoogleLogin(req, res) {
  const client = createLoginOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'online',
    scope: LOGIN_SCOPES,
    prompt: 'select_account',
    state: startOAuthFlow(req, res, 'login'),
  });
  res.redirect(url);
}

export async function handleGoogleLoginCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${env.clientOrigin}/login?error=missing_code`);
  }
  if (!isValidOAuthState(req, res, 'login')) {
    return res.redirect(`${env.clientOrigin}/login?error=invalid_state`);
  }

  try {
    const client = createLoginOAuthClient();
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const payload = ticket.getPayload();

    const email = payload.email?.toLowerCase();
    if (!email) {
      return res.redirect(`${env.clientOrigin}/login?error=login_failed`);
    }
    // Roles and the Email feature are granted by matching this address, so it has to be one
    // Google has actually verified belongs to the person signing in.
    if (payload.email_verified !== true) {
      return res.redirect(`${env.clientOrigin}/login?error=not_verified`);
    }
    if (!isAllowedLogin(email)) {
      console.warn('[auth] sign-in refused for an account outside the allowed list');
      return res.redirect(`${env.clientOrigin}/login?error=not_allowed`);
    }

    const role = roleFor(email);

    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      {
        googleId: payload.sub,
        email,
        name: payload.name || email,
        picture: payload.picture,
        role,
        lastLoginAt: new Date(),
      },
      { upsert: true, returnDocument: 'after' },
    );

    issueSessionCookie(req, res, user);
    res.redirect(env.clientOrigin);
  } catch (err) {
    console.error('[auth] Google login failed:', err.message);
    res.redirect(`${env.clientOrigin}/login?error=login_failed`);
  }
}

export async function getCurrentUser(req, res) {
  const user = await User.findById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    email: user.email,
    name: user.name,
    picture: user.picture,
    // The role the server enforces right now (middleware/auth.js), not the one stored at the
    // user's last sign-in — otherwise the UI and the API could disagree about what they may do.
    role: req.user.role,
    title: user.title,
  });
}

export function logout(req, res) {
  res.clearCookie('session', crossSiteCookieOptions(req));
  res.json({ ok: true });
}

export function redirectToDriveConnect(req, res) {
  const client = createDriveOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: DRIVE_SYNC_SCOPES,
    prompt: 'consent',
    state: startOAuthFlow(req, res, 'drive'),
  });
  res.redirect(url);
}

export async function handleDriveConnectCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${env.clientOrigin}/settings?driveConnect=missing_code`);
  }
  if (!isValidOAuthState(req, res, 'drive')) {
    return res.redirect(`${env.clientOrigin}/settings?driveConnect=invalid_state`);
  }

  try {
    const client = createDriveOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return res.redirect(`${env.clientOrigin}/settings?driveConnect=no_refresh_token`);
    }

    let grantedByEmail = req.user.email;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
      grantedByEmail = ticket.getPayload().email?.toLowerCase() || grantedByEmail;
    }

    await GoogleToken.findOneAndUpdate(
      { purpose: 'drive-sync' },
      {
        purpose: 'drive-sync',
        encryptedRefreshToken: encryptText(tokens.refresh_token),
        scope: tokens.scope,
        connectedByEmail: grantedByEmail,
        connectedAt: new Date(),
      },
      { upsert: true },
    );

    res.redirect(`${env.clientOrigin}/settings?driveConnect=success`);
  } catch (err) {
    console.error('[auth] Drive connect failed:', err.message);
    res.redirect(`${env.clientOrigin}/settings?driveConnect=failed`);
  }
}

export async function disconnectDrive(req, res) {
  await GoogleToken.deleteOne({ purpose: 'drive-sync' });
  res.json({ ok: true });
}

// Render's outbound network blocks SMTP entirely (confirmed: connections to Gmail's SMTP
// host time out on every address/port tried), so sending goes through the Gmail API over
// plain HTTPS instead — a port that's never blocked. That needs its own OAuth grant, from
// pc.hsd@salasartechno.com specifically, since only that account can authorize "send email
// as me." Route access is restricted (requireEmail) to that same account, matching who's
// allowed to use the Email page at all.
export function redirectToGmailConnect(req, res) {
  const client = createGmailOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SEND_SCOPES,
    prompt: 'consent',
    login_hint: env.emailUser,
    state: startOAuthFlow(req, res, 'gmail'),
  });
  res.redirect(url);
}

export async function handleGmailConnectCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${env.clientOrigin}/email?gmailConnect=missing_code`);
  }
  if (!isValidOAuthState(req, res, 'gmail')) {
    return res.redirect(`${env.clientOrigin}/email?gmailConnect=invalid_state`);
  }

  try {
    const client = createGmailOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return res.redirect(`${env.clientOrigin}/email?gmailConnect=no_refresh_token`);
    }

    let grantedByEmail = req.user.email;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
      grantedByEmail = ticket.getPayload().email?.toLowerCase() || grantedByEmail;
    }

    if (grantedByEmail !== env.emailUser?.toLowerCase()) {
      return res.redirect(`${env.clientOrigin}/email?gmailConnect=wrong_account`);
    }

    await GoogleToken.findOneAndUpdate(
      { purpose: 'gmail-send' },
      {
        purpose: 'gmail-send',
        encryptedRefreshToken: encryptText(tokens.refresh_token),
        scope: tokens.scope,
        connectedByEmail: grantedByEmail,
        connectedAt: new Date(),
      },
      { upsert: true },
    );

    res.redirect(`${env.clientOrigin}/email?gmailConnect=success`);
  } catch (err) {
    console.error('[auth] Gmail send connect failed:', err.message);
    res.redirect(`${env.clientOrigin}/email?gmailConnect=failed`);
  }
}

export async function getGmailSendStatus(req, res) {
  const tokenDoc = await GoogleToken.findOne({ purpose: 'gmail-send' }).lean();
  res.json({
    connected: Boolean(tokenDoc),
    connectedByEmail: tokenDoc?.connectedByEmail ?? null,
    connectedAt: tokenDoc?.connectedAt ?? null,
  });
}
