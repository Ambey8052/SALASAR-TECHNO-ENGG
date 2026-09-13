import { Router } from 'express';
import { listTargets, upsertTarget, deleteTarget } from '../controllers/target.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', requireAuth, asyncHandler(listTargets));
router.post('/', requireAuth, requireAdmin, asyncHandler(upsertTarget));
router.delete('/:client', requireAuth, requireAdmin, asyncHandler(deleteTarget));

export default router;
