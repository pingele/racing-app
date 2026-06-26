import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listPicks } from '../controllers/pickController.js';

const router = Router();

router.get('/', requireAuth, listPicks);

export default router;
