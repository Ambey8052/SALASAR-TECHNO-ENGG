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
import { env } from '../config/env.js';

const router = Router();

router.get('/google', redirectToGoogleLogin);
router.get('/google/callback', handleGoogleLoginCallback);
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', logout);

router.get('/google/connect-drive', requireAuth, requireAdmin, redirectToDriveConnect);
router.get('/google/connect-drive/callback', requireAuth, requireAdmin, handleDriveConnectCallback);
router.post('/google/disconnect-drive', requireAuth, requireAdmin, disconnectDrive);

const restrictedToEmailSender = requireEmail(env.emailUser);
router.get('/google/connect-gmail', requireAuth, restrictedToEmailSender, redirectToGmailConnect);
router.get('/google/connect-gmail/callback', requireAuth, restrictedToEmailSender, handleGmailConnectCallback);
router.get('/google/gmail-send-status', requireAuth, restrictedToEmailSender, getGmailSendStatus);

export default router;
