import { Router } from 'express';
import {
  redirectToGoogleLogin,
  handleGoogleLoginCallback,
  getCurrentUser,
  logout,
  redirectToDriveConnect,
  handleDriveConnectCallback,
  disconnectDrive,
} from '../controllers/auth.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/google', redirectToGoogleLogin);
router.get('/google/callback', handleGoogleLoginCallback);
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', logout);

router.get('/google/connect-drive', requireAuth, requireAdmin, redirectToDriveConnect);
router.get('/google/connect-drive/callback', requireAuth, requireAdmin, handleDriveConnectCallback);
router.post('/google/disconnect-drive', requireAuth, requireAdmin, disconnectDrive);

export default router;
