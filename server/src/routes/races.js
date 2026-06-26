import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/index.js';
import { listRaces, getRace, syncRaces, getCalendar, syncRaceOnDemand, listSessions, getSessionResults } from '../controllers/raceController.js';
import {
  createPick,
  getMyPickForRace,
  createPickSchema,
} from '../controllers/pickController.js';

const router = Router();

router.get('/', listRaces);
router.get('/calendar', getCalendar);
router.post('/sync', requireAuth, syncRaces);
router.post('/sync/:externalId', requireAuth, syncRaceOnDemand);
router.get('/:id', getRace);
router.get('/:id/sessions', listSessions);
router.get('/:id/sessions/:sessionId', getSessionResults);

// Picks nested under a race.
router.post('/:raceId/picks', requireAuth, validateBody(createPickSchema), createPick);
router.get('/:raceId/picks/me', requireAuth, getMyPickForRace);

export default router;
