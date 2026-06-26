import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schemaSql.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Bootstrap schema on first connection so prepared statements in other modules
// (evaluated at import time) always have their tables available.
db.exec(SCHEMA_SQL);

// Lightweight migration: add per-driver result detail columns if missing.
const resultCols = new Set(
  db.prepare("PRAGMA table_info('race_results')").all().map((c) => c.name)
);
for (const [col, type] of [
  ['laps', 'INTEGER'],
  ['best_lap_time', 'TEXT'],
  ['last_lap_time', 'TEXT'],
  ['total_time', 'TEXT'],
]) {
  if (!resultCols.has(col)) db.exec(`ALTER TABLE race_results ADD COLUMN ${col} ${type}`);
}

export default db;
