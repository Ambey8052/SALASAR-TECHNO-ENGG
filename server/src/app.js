import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
// The email-compose body can carry a few inline images as base64 data URLs, so it gets a
// much larger limit than the rest of the API, which stays on the small default.
app.use('/api/email', express.json({ limit: '20mb' }));
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitize());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/google', authLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/email', emailRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});
