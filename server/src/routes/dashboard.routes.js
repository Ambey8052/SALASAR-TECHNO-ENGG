import { Router } from 'express';
import { getHsdSummary, listManpowerRecords } from '../controllers/dashboard.controller.js';
import { getHsdInsights } from '../controllers/insights.controller.js';
import { getSynopsisSummary } from '../controllers/synopsis.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/hsd/summary', requireAuth, asyncHandler(getHsdSummary));
router.get('/hsd/insights', requireAuth, asyncHandler(getHsdInsights));
router.get('/manpower', requireAuth, asyncHandler(listManpowerRecords));
router.get('/synopsis', requireAuth, asyncHandler(getSynopsisSummary));

export default router;
