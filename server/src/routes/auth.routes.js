import { Router } from 'express';
import {
  redirectToGoogleLogin,
  handleGoogleLoginCallback,
  getCurrentUser,
  logout,
  redirectToDriveConnect,
  handleDriveConnectCallback,
  disconnectDrive,
  redirectToGmailConnect,
  handleGmailConnectCallback,
  getGmailSendStatus,
} from '../controllers/auth.controller.js';
import { requireAuth, requireAdmin, requireEmail } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/google', redirectToGoogleLogin);
router.get('/google/callback', asyncHandler(handleGoogleLoginCallback));
router.get('/me', requireAuth, asyncHandler(getCurrentUser));
router.post('/logout', logout);

router.get('/google/connect-drive', requireAuth, requireAdmin, redirectToDriveConnect);
router.get('/google/connect-drive/callback', requireAuth, requireAdmin, asyncHandler(handleDriveConnectCallback));
router.post('/google/disconnect-drive', requireAuth, requireAdmin, asyncHandler(disconnectDrive));

const restrictedToEmailSender = requireEmail(env.emailUser);
router.get('/google/connect-gmail', requireAuth, restrictedToEmailSender, redirectToGmailConnect);
router.get('/google/connect-gmail/callback', requireAuth, restrictedToEmailSender, asyncHandler(handleGmailConnectCallback));
router.get('/google/gmail-send-status', requireAuth, restrictedToEmailSender, asyncHandler(getGmailSendStatus));

export default router;
