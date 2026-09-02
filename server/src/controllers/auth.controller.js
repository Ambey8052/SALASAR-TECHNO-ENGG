import jwt from 'jsonwebtoken';
import { createLoginOAuthClient, createDriveOAuthClient, LOGIN_SCOPES, DRIVE_SYNC_SCOPES } from '../config/google.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { encryptText } from '../utils/crypto.js';

function issueSessionCookie(res, user) {
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, name: user.name, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
  const isProd = env.nodeEnv === 'production';
  res.cookie('session', token, {
    httpOnly: true,
    // The deployed client (Vercel) and server (Render) sit on different domains, so the
    // session cookie is cross-site from the browser's point of view — that only gets sent
    // on fetch/XHR (as opposed to a top-level OAuth-redirect navigation) if SameSite=None,
    // which itself requires Secure. Locally, client and server share localhost so Lax (and
    // no HTTPS) is fine and simpler.
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
};

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

    issueSessionCookie(res, user);
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
  res.clearCookie('session', CLEAR_COOKIE_OPTIONS);
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
