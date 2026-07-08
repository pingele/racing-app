// k6 HTTP load test for the AppSync GraphQL tier. Read-heavy mix that mirrors
// the app's real access patterns, ramping to LT_VUS (default 2000) virtual users.
//
//   k6 run loadtest/journey.js
//   k6 run -e LT_VUS=500 -e LT_HOLD=2m loadtest/journey.js
//
// Requires tokens.json (run mint-tokens.mjs) next to this file. Each VU uses a
// different pre-minted ID token as its Authorization header.
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';
import { Trend } from 'k6/metrics';

const URL = __ENV.LT_GRAPHQL_URL; // set from config below via -e, or hardcode
const VUS = Number(__ENV.LT_VUS || 2000);
const RAMP = __ENV.LT_RAMP || '3m';
const HOLD = __ENV.LT_HOLD || '5m';

const tokens = new SharedArray('tokens', () =>
  JSON.parse(open('./tokens.json')),
);

const standingsLatency = new Trend('standings_latency', true);
const raceBundleLatency = new Trend('race_bundle_latency', true);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '1m', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000'],
  },
};

if (!URL) {
  throw new Error(
    'Set the GraphQL URL: k6 run -e LT_GRAPHQL_URL=<data.url> loadtest/journey.js',
  );
}

function subOf(token) {
  const payload = token.split('.')[1];
  return JSON.parse(encoding.b64decode(payload, 'rawurl', 's')).sub;
}

function gql(token, query, variables, tag) {
  return http.post(URL, JSON.stringify({ query, variables }), {
    headers: { 'Content-Type': 'application/json', Authorization: token },
    tags: { op: tag },
  });
}

// --- operations mirroring client/src/api/client.js --------------------------
function listRaces(token) {
  const res = gql(
    token,
    'query { listRaces(limit: 200) { items { id name status eventDate } } }',
    {},
    'listRaces',
  );
  check(res, { 'listRaces 200': (r) => r.status === 200 });
  const items = res.json('data.listRaces.items') || [];
  return items;
}

// The getRace() bundle: classes, entries, and predictions for one race.
function raceBundle(token, raceId) {
  const q = `query($rid: ID!) {
    listRaceClassByRaceId(raceId: $rid, limit: 50) { items { id name sortOrder } }
    listEntryByRaceId(raceId: $rid, limit: 2000) { items { id classId carNumber driverName } }
    listPredictionByRaceId(raceId: $rid, limit: 2000) { items { id userId classId } }
  }`;
  const res = gql(token, q, { rid: raceId }, 'raceBundle');
  raceBundleLatency.add(res.timings.duration);
  check(res, { 'raceBundle 200': (r) => r.status === 200 });
}

// standings(): the full Prediction scan the Standings page + leaderboard drive.
function standings(token) {
  const res = gql(
    token,
    'query { listPredictions(limit: 1000) { items { id userId raceId displayName pointsAwarded scoredAt } } }',
    {},
    'standings',
  );
  standingsLatency.add(res.timings.duration);
  check(res, { 'standings 200': (r) => r.status === 200 });
}

function savePrediction(token, races) {
  if (!races.length) return;
  const race = races[Math.floor(Math.random() * races.length)];
  // Discover a class + its entries for this race, then create a prediction.
  const bundle = gql(
    token,
    `query($rid: ID!) {
      listRaceClassByRaceId(raceId: $rid, limit: 1) { items { id } }
      listEntryByRaceId(raceId: $rid, limit: 60) { items { id classId } }
    }`,
    { rid: race.id },
    'savePrediction:lookup',
  );
  const classId = bundle.json('data.listRaceClassByRaceId.items.0.id');
  const entries = (bundle.json('data.listEntryByRaceId.items') || []).filter(
    (e) => e.classId === classId,
  );
  if (!classId || entries.length === 0) return;
  const orderedEntryIds = entries.map((e) => e.id);
  const res = gql(
    token,
    `mutation($input: CreatePredictionInput!) {
      createPrediction(input: $input) { id }
    }`,
    {
      input: {
        raceId: race.id,
        classId,
        userId: subOf(token),
        displayName: 'Load Tester',
        orderedEntryIds,
      },
    },
    'savePrediction:create',
  );
  check(res, { 'savePrediction 200': (r) => r.status === 200 });
}

export default function () {
  const token = tokens[__VU % tokens.length];
  const roll = Math.random();
  if (roll < 0.6) {
    // Browse: list races then open one (the common path).
    const races = listRaces(token);
    if (races.length) {
      raceBundle(token, races[Math.floor(Math.random() * races.length)].id);
    }
  } else if (roll < 0.9) {
    // Check standings (expensive full-table read).
    standings(token);
  } else {
    // Save a prediction (write).
    savePrediction(token, listRaces(token));
  }
}
