import { Router } from 'express';
import { triggerManualSync, getSyncStatus } from '../controllers/sync.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/status', requireAuth, asyncHandler(getSyncStatus));
router.post('/run', requireAuth, requireAdmin, asyncHandler(triggerManualSync));

export default router;
