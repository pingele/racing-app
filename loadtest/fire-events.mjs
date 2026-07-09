// Generate subscription fan-out by creating + updating predictions as a real
// user (which triggers onCreate/onUpdatePrediction to every subscriber). Run
// this while hold-subscriptions.mjs is holding connections open.
//
//   node fire-events.mjs
//   LT_FIRE=50 LT_FIRE_DELAY_MS=200 node fire-events.mjs
//
// Requires tokens.json and seed-manifest.json (so it has a race to attach to).
import { readFileSync } from 'node:fs';
import { GRAPHQL_HTTP, num, paths } from './config.mjs';
import { decodeJwt } from './util.mjs';

const COUNT = num('LT_FIRE', 30);
const DELAY_MS = num('LT_FIRE_DELAY_MS', 250);

const token = JSON.parse(readFileSync(paths.tokens, 'utf8'))[0];
if (!token) throw new Error('tokens.json is empty — run mint-tokens.mjs first.');
const sub = decodeJwt(token).sub;

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// Find a class + its entries to build a valid prediction.
const seed = JSON.parse(readFileSync(paths.seed, 'utf8'));
const raceId = seed.raceIds?.[0];
if (!raceId) throw new Error('seed-manifest.json has no raceIds — run seed.mjs first.');

const bundle = await gql(
  `query($rid: ID!) {
    listRaceClassByRaceId(raceId: $rid, limit: 1) { items { id } }
    listEntryByRaceId(raceId: $rid, limit: 60) { items { id classId } }
  }`,
  { rid: raceId },
);
const classId = bundle.listRaceClassByRaceId.items[0]?.id;
const orderedEntryIds = bundle.listEntryByRaceId.items
  .filter((e) => e.classId === classId)
  .map((e) => e.id);

console.log(`Firing ${COUNT} create+update cycles against race ${raceId}…`);
for (let i = 0; i < COUNT; i++) {
  const created = await gql(
    `mutation($input: CreatePredictionInput!) { createPrediction(input: $input) { id } }`,
    { input: { raceId, classId, userId: sub, displayName: 'Fan-out Tester', orderedEntryIds } },
  );
  const id = created.createPrediction.id;
  // Update it to simulate a scoring write (onUpdatePrediction fan-out).
  await gql(
    `mutation($input: UpdatePredictionInput!) { updatePrediction(input: $input) { id } }`,
    { input: { id, pointsAwarded: 25, scoredAt: new Date().toISOString() } },
  );
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${COUNT}`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.log('Done firing events.');
