import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendReport } from '../controllers/email.controller.js';
import { requireAuth, requireEmail } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

// Sends real email from a real mailbox — keep this tight regardless of the general API limit.
const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/send', requireAuth, requireEmail(env.emailUser), sendLimiter, sendReport);

export default router;
