import { Router } from 'express';
import { getHsdSummary, listManpowerRecords } from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/hsd/summary', requireAuth, getHsdSummary);
router.get('/manpower', requireAuth, listManpowerRecords);

export default router;
