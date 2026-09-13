import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import syncRoutes from './routes/sync.routes.js';
import targetRoutes from './routes/target.routes.js';
import emailRoutes from './routes/email.routes.js';

export const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.clientOrigin, credentials: true }));
// Everything except the email routes stays on the small default body limit. The email routes
// parse their own, larger body — after authentication (routes/email.routes.js).
const defaultJson = express.json();
app.use((req, res, next) => (req.path.startsWith('/api/email') ? next() : defaultJson(req, res, next)));
app.use(cookieParser());
app.use(mongoSanitize());

// The session cookie has to be SameSite=None (client and API are different sites), so the
// browser attaches it to requests *any* page makes. CORS stops a hostile page reading the
// answer, not sending the request: a plain cross-site POST could disconnect Drive or start
// syncs on an admin's behalf (SECURITY_REPORT SEC-04). Browsers always send Origin on such
// requests, so a state-changing request from anywhere but the dashboard is refused. Requests
// with no Origin at all (curl, server-to-server) carry no browser cookie jar to abuse.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (SAFE_METHODS.has(req.method) || !origin || origin === env.clientOrigin) return next();
  return res.status(403).json({ error: 'Cross-site request refused' });
});

// Signed-in traffic is limited per user, not per IP: the whole plant sits behind one office
// connection, and a per-IP limit meant about twenty open dashboards (each polling sync status
// once a minute) exhausted it for everyone. Anonymous traffic is still limited per IP.
function sessionSubject(req) {
  try {
    return jwt.verify(req.cookies?.session, env.jwtSecret).sub;
  } catch {
    return null;
  }
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const subject = sessionSubject(req);
    return subject ? `user:${subject}` : ipKeyGenerator(req.ip);
  },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/google', authLimiter);

// Kept trivial on purpose: it is the keep-alive target, pinged every 10 minutes.
app.get('/api/health', (req, res) => res.json({ ok: true }));
// Whether the server can actually serve data. /health says "ok" with the database gone.
app.get('/api/health/deep', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({ ok: dbConnected, db: dbConnected ? 'connected' : 'disconnected' });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/email', emailRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  // A request the client got wrong — malformed JSON, an oversized body, an id that is not an
  // ObjectId — is the client's error, not the server's.
  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.expose ? err.message : 'Bad request' });
  }
  if (err.name === 'CastError' || err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Invalid request' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});
