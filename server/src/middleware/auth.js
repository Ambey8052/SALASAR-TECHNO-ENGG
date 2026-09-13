import jwt from 'jsonwebtoken';
import { env, isAllowedLogin, roleFor } from '../config/env.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  let claims;
  try {
    claims = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // The token is proof of who signed in, not of what they may do now. Access and role are
  // re-derived from the current configuration on every request: taking someone out of
  // ADMIN_EMAILS, or narrowing who may sign in, used to take effect only when their 12-hour
  // session happened to expire.
  if (!isAllowedLogin(claims.email)) {
    return res.status(403).json({ error: 'This account is not allowed to use the dashboard.' });
  }
  req.user = { ...claims, role: roleFor(claims.email) };
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireEmail(allowedEmail) {
  const normalized = allowedEmail?.toLowerCase();
  return (req, res, next) => {
    if (!normalized || req.user?.email?.toLowerCase() !== normalized) {
      return res.status(403).json({ error: 'Not authorized for this action' });
    }
    next();
  };
}
