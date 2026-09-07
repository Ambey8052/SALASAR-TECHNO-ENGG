import { Router } from 'express';
import { getHsdSummary, listManpowerRecords } from '../controllers/dashboard.controller.js';
import { getHsdInsights } from '../controllers/insights.controller.js';
import { getSynopsisSummary } from '../controllers/synopsis.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/hsd/summary', requireAuth, getHsdSummary);
router.get('/hsd/insights', requireAuth, getHsdInsights);
router.get('/manpower', requireAuth, listManpowerRecords);
router.get('/synopsis', requireAuth, getSynopsisSummary);

export default router;
