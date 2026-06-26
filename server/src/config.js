import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  databasePath: path.resolve(
    __dirname,
    '..',
    process.env.DATABASE_PATH || './data/racing.sqlite'
  ),
  raceProvider: (process.env.RACE_PROVIDER || 'mock').toLowerCase(),
  raceMonitorBaseUrl: process.env.RACE_MONITOR_BASE_URL || 'https://api.race-monitor.com',
  raceMonitorToken: process.env.RACE_MONITOR_TOKEN || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};
