import { Router } from 'express';
import { listTargets, upsertTarget, deleteTarget } from '../controllers/target.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listTargets);
router.post('/', requireAuth, requireAdmin, upsertTarget);
router.delete('/:client', requireAuth, requireAdmin, deleteTarget);

export default router;
