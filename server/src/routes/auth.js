import { Router } from 'express';
import { validateBody } from '../middleware/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  register,
  login,
  me,
  registerSchema,
  loginSchema,
} from '../controllers/authController.js';

const router = Router();

router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);
router.get('/me', requireAuth, me);

export default router;
