import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { sendReport, scheduleReport, listScheduledEmails, cancelScheduledEmail } from '../controllers/email.controller.js';
import { requireAuth, requireEmail } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

const router = Router();

// Sends real email from a real mailbox — keep this tight regardless of the general API limit.
const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// The compose body can carry a few inline images as base64 data URLs, so it gets a much larger
// limit than the rest of the API. It is parsed only after the caller has been authenticated and
// authorised: mounted app-wide, as it was, anyone on the internet could make the server buffer
// and parse 20 MB per request. The body is sanitised here for the same reason app.js sanitises
// every other route — the app-level pass runs before this parser has filled req.body.
const largeJson = [express.json({ limit: '20mb' }), mongoSanitize()];

const restricted = [requireAuth, requireEmail(env.emailUser)];

router.post('/send', ...restricted, sendLimiter, ...largeJson, asyncHandler(sendReport));
router.post('/schedule', ...restricted, sendLimiter, ...largeJson, asyncHandler(scheduleReport));
router.get('/scheduled', ...restricted, asyncHandler(listScheduledEmails));
router.delete('/scheduled/:id', ...restricted, asyncHandler(cancelScheduledEmail));

export default router;
