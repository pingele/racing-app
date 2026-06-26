import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler } from './middleware/index.js';
import authRoutes from './routes/auth.js';
import raceRoutes from './routes/races.js';
import pickRoutes from './routes/picks.js';
import leaderboardRoutes from './routes/leaderboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const hasStaticBundle = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/races', raceRoutes);
  app.use('/api/picks', pickRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);

  // Single-origin deploy: serve the built PWA from server/public when present.
  if (hasStaticBundle) {
    app.use(express.static(PUBLIC_DIR, { index: false }));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}
