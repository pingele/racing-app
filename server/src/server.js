import { createApp } from './app.js';
import { config } from './config.js';
import { createSchema } from './db/schema.js';
import db from './db/connection.js';
import { defaultScoringRules } from './services/mockData.js';
import { syncAllRaces } from './services/raceSync.js';

createSchema();

// First-deploy bootstrap: when running against an empty data volume,
// seed scoring rules and sync races so the app is usable immediately.
async function bootstrap() {
  const ruleCount = db.prepare('SELECT COUNT(*) AS n FROM scoring_rules').get().n;
  if (ruleCount === 0) {
    const insert = db.prepare(
      'INSERT INTO scoring_rules (finish_position, points) VALUES (@finish_position, @points)'
    );
    db.transaction(() => {
      for (const rule of defaultScoringRules) insert.run(rule);
    })();
    console.log(`Seeded ${defaultScoringRules.length} scoring rules.`);
  }

  const raceCount = db.prepare('SELECT COUNT(*) AS n FROM races').get().n;
  if (raceCount === 0) {
    try {
      const synced = await syncAllRaces();
      console.log(`Synced ${synced} races from provider on first boot.`);
    } catch (err) {
      console.error('Initial race sync failed (will retry on demand):', err.message);
    }
  }
}

await bootstrap();

const app = createApp();

app.listen(config.port, () => {
  console.log(`Racing API listening on port ${config.port}`);
  console.log(`Race provider: ${config.raceProvider}`);
});
