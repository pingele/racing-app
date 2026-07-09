// Seed realistic volume so standings()/getRace() do real work under load.
// Writes Races → Classes → Entries → Predictions DIRECTLY to DynamoDB (fast,
// and it sidesteps the owner-auth checks that GraphQL writes would impose).
//
//   node seed.mjs
//   LT_RACES=20 LT_PREDS_PER_USER=12 node seed.mjs
//
// Table names are discovered by matching the AppSync API id; override any with
// LT_TABLE_RACE / LT_TABLE_RACECLASS / LT_TABLE_ENTRY / LT_TABLE_PREDICTION.
// Requires AWS credentials with DynamoDB write access.
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { REGION, API_ID, num, paths } from './config.mjs';
import { shuffle } from './util.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const RACES = num('LT_RACES', 12);
const CLASSES_PER_RACE = num('LT_CLASSES_PER_RACE', 4);
const ENTRIES_PER_CLASS = num('LT_ENTRIES_PER_CLASS', 22);
const PREDS_PER_USER = num('LT_PREDS_PER_USER', 8);
const COMPLETED_RATIO = Number(process.env.LT_COMPLETED_RATIO ?? 0.5);
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

async function discoverTables() {
  const names = [];
  let next;
  do {
    const res = await ddb.send(
      new ListTablesCommand({ ExclusiveStartTableName: next, Limit: 100 }),
    );
    names.push(...(res.TableNames ?? []));
    next = res.LastEvaluatedTableName;
  } while (next);

  const find = (model) => {
    const override = process.env[`LT_TABLE_${model.toUpperCase()}`];
    if (override) return override;
    const match = names.find(
      (n) => n.startsWith(`${model}-`) && n.includes(API_ID),
    );
    if (!match) {
      throw new Error(
        `No DynamoDB table found for model "${model}" (API id ${API_ID}). ` +
          `Set LT_TABLE_${model.toUpperCase()} to override.`,
      );
    }
    return match;
  };

  return {
    Race: find('Race'),
    RaceClass: find('RaceClass'),
    Entry: find('Entry'),
    Prediction: find('Prediction'),
  };
}

const nowIso = () => new Date().toISOString();
const meta = (typename) => {
  const t = nowIso();
  return { __typename: typename, createdAt: t, updatedAt: t };
};

async function batchPut(table, items) {
  for (let i = 0; i < items.length; i += 25) {
    let requestItems = {
      [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await ddb.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );
      const unprocessed = res.UnprocessedItems?.[table];
      if (!unprocessed?.length) break;
      requestItems = { [table]: unprocessed };
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
}

// ---- build the object graph ------------------------------------------------
const tables = await discoverTables();
console.log('Discovered tables:', tables);

const users = JSON.parse(readFileSync(paths.users, 'utf8')).filter((u) => u.sub);
if (!users.length) throw new Error('users.json has no users with a sub — run create-users.mjs first.');

const races = [];
const classes = [];
const entries = [];
const classPool = []; // { raceId, classId, entryIds, completed }

for (let r = 0; r < RACES; r++) {
  const raceId = randomUUID();
  const completed = r < Math.floor(RACES * COMPLETED_RATIO);
  races.push({
    id: raceId,
    mrpEventId: `LT-${1000 + r}`,
    name: `Load Test Race ${r + 1}`,
    track: `Test Track ${1 + (r % 5)}`,
    location: 'Test City, IA',
    eventDate: new Date(Date.UTC(2026, 0, 1 + r)).toISOString(),
    status: completed ? 'completed' : 'scheduled',
    predictionsLocked: completed,
    hidden: false,
    ...meta('Race'),
  });
  for (let c = 0; c < CLASSES_PER_RACE; c++) {
    const classId = randomUUID();
    const entryIds = [];
    for (let e = 0; e < ENTRIES_PER_CLASS; e++) {
      const entryId = randomUUID();
      entryIds.push(entryId);
      entries.push({
        id: entryId,
        raceId,
        classId,
        mrpEntryId: `${classId}-${e}`,
        carNumber: String(((e * 7) % 99) + 1),
        driverName: `Driver ${r + 1}-${c + 1}-${e + 1}`,
        hometown: 'Anytown, US',
        sortOrder: e,
        ...meta('Entry'),
      });
    }
    classes.push({
      id: classId,
      raceId,
      mrpClassId: `${raceId}-${c}`,
      name: `Class ${String.fromCharCode(65 + c)}`,
      raceType: 'A Feature',
      series: '410 Sprints',
      entryCount: ENTRIES_PER_CLASS,
      sortOrder: c,
      locked: completed,
      ...meta('RaceClass'),
    });
    classPool.push({ raceId, classId, entryIds, completed });
  }
}

const predictions = [];
for (const u of users) {
  const chosen = shuffle([...classPool]).slice(0, PREDS_PER_USER);
  for (const cl of chosen) {
    const scored = cl.completed;
    predictions.push({
      id: randomUUID(),
      raceId: cl.raceId,
      classId: cl.classId,
      userId: u.sub,
      owner: u.sub, // best-effort; authenticated-read standings never filter on it
      displayName: u.nickname,
      orderedEntryIds: shuffle([...cl.entryIds]),
      // ~half of scored predictions land on a points-paying position.
      pointsAwarded: scored
        ? Math.random() < 0.5
          ? POINTS[Math.floor(Math.random() * POINTS.length)]
          : 0
        : undefined,
      scoredAt: scored ? nowIso() : undefined,
      ...meta('Prediction'),
    });
  }
}

// ---- write -----------------------------------------------------------------
console.log(
  `Seeding ${races.length} races, ${classes.length} classes, ${entries.length} entries, ${predictions.length} predictions…`,
);
await batchPut(tables.Race, races);
await batchPut(tables.RaceClass, classes);
await batchPut(tables.Entry, entries);
await batchPut(tables.Prediction, predictions);

writeFileSync(
  paths.seed,
  JSON.stringify(
    {
      tables,
      counts: {
        races: races.length,
        classes: classes.length,
        entries: entries.length,
        predictions: predictions.length,
      },
      raceIds: races.map((r) => r.id),
    },
    null,
    2,
  ),
);
console.log('Done. Wrote seed-manifest.json.');
