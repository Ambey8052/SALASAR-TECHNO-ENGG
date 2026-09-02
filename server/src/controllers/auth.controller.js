import jwt from 'jsonwebtoken';
import { createLoginOAuthClient, createDriveOAuthClient, LOGIN_SCOPES, DRIVE_SYNC_SCOPES } from '../config/google.js';
import { env } from '../config/env.js';
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
  });
  res.redirect(url);
}

export async function handleGoogleLoginCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${env.clientOrigin}/login?error=missing_code`);
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

    const role = env.adminEmails.includes(email) ? 'admin' : 'manager';

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
    role: user.role,
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
  });
  res.redirect(url);
}

export async function handleDriveConnectCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.redirect(`${env.clientOrigin}/settings?driveConnect=missing_code`);
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
