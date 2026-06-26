import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db/connection.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/index.js';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(50),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)'
);

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

export const register = asyncHandler(async (req, res) => {
  const { email, password, displayName } = req.body;
  if (findByEmail.get(email)) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const hash = await bcrypt.hash(password, 10);
  const info = insertUser.run(email, hash, displayName);
  const user = { id: info.lastInsertRowid, email, display_name: displayName };
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = findByEmail.get(email);
  if (!user) throw new HttpError(401, 'Invalid email or password');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, displayName: req.user.name } });
});
