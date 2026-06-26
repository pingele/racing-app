import db from './connection.js';
import { createSchema } from './schema.js';
import { defaultScoringRules } from '../services/mockData.js';
import { syncAllRaces } from '../services/raceSync.js';

const insertScoringRule = db.prepare(`
  INSERT INTO scoring_rules (finish_position, points)
  VALUES (@finish_position, @points)
  ON CONFLICT(finish_position) DO UPDATE SET points = excluded.points
`);

async function seed() {
  console.log('Creating schema...');
  createSchema();

  console.log('Seeding scoring rules...');
  const tx = db.transaction(() => {
    for (const rule of defaultScoringRules) insertScoringRule.run(rule);
  });
  tx();

  console.log('Syncing races from provider...');
  const count = await syncAllRaces();
  console.log(`Seed complete. Synced ${count} races.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
