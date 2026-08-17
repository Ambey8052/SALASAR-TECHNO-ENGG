import { Router } from 'express';
import { triggerManualSync, getSyncStatus } from '../controllers/sync.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/status', requireAuth, getSyncStatus);
router.post('/run', requireAuth, requireAdmin, triggerManualSync);

export default router;
