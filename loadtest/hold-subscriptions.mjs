// Hold N concurrent AppSync realtime subscriptions — the exact path the
// leaderboard's observeQuery uses — and report connect success + event
// (fan-out) counts. Run this, then run fire-events.mjs (or score a race in the
// app) in another terminal and watch the event counter climb.
//
//   node hold-subscriptions.mjs
//   LT_SUBS=500 LT_SUBS_DURATION_S=180 node hold-subscriptions.mjs
//
// Uses raw WebSockets (one per user token) because the Amplify JS client is a
// singleton and can't hold many distinct authenticated sessions at once.
// Requires: npm i (installs the `ws` dependency) and tokens.json.
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { GRAPHQL_WS, HTTP_HOST, num, paths } from './config.mjs';
import { mapLimit } from './util.mjs';

const COUNT = num('LT_SUBS', 300);
const DURATION_MS = num('LT_SUBS_DURATION_S', 300) * 1000;
const RAMP_MS = num('LT_SUBS_RAMP_MS', 15); // stagger between opens

// observeQuery listens to all three mutation events; scoring is an update.
const SUB_QUERY = {
  query: `subscription {
    onUpdatePrediction { id userId pointsAwarded scoredAt }
  }`,
};

const tokens = JSON.parse(readFileSync(paths.tokens, 'utf8')).slice(0, COUNT);
if (!tokens.length) throw new Error('tokens.json is empty — run mint-tokens.mjs first.');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

const stats = { connected: 0, acked: 0, events: 0, errors: 0, closed: 0 };
const sockets = [];

function open(token) {
  return new Promise((resolve) => {
    const auth = { Authorization: token, host: HTTP_HOST };
    const url = `${GRAPHQL_WS}?header=${encodeURIComponent(
      b64(auth),
    )}&payload=${encodeURIComponent(b64({}))}`;
    const ws = new WebSocket(url, 'graphql-ws');
    const subId = randomUUID();
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve(ws);
      }
    };

    ws.on('open', () => {
      stats.connected++;
      ws.send(JSON.stringify({ type: 'connection_init' }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'connection_ack':
          ws.send(
            JSON.stringify({
              id: subId,
              type: 'start',
              payload: {
                data: JSON.stringify(SUB_QUERY),
                extensions: { authorization: auth },
              },
            }),
          );
          break;
        case 'start_ack':
          stats.acked++;
          settle();
          break;
        case 'data':
          stats.events++;
          break;
        case 'error':
        case 'connection_error':
          stats.errors++;
          settle();
          break;
      }
    });
    ws.on('error', () => {
      stats.errors++;
      settle();
    });
    ws.on('close', () => {
      stats.closed++;
    });
    sockets.push(ws);
  });
}

console.log(
  `Opening ${tokens.length} subscriptions to ${GRAPHQL_WS} (host ${HTTP_HOST})…`,
);

const report = setInterval(() => {
  console.log(
    `  connected=${stats.connected} acked=${stats.acked} events=${stats.events} errors=${stats.errors} closed=${stats.closed}`,
  );
}, 5000);

// Ramp opens gently so we test steady-state connections, not a connect storm.
await mapLimit(tokens, 25, async (token, i) => {
  await new Promise((r) => setTimeout(r, (i % 25) * RAMP_MS));
  await open(token);
});

console.log(
  `All open. Holding for ${DURATION_MS / 1000}s. Run fire-events.mjs now to generate fan-out.`,
);
await new Promise((r) => setTimeout(r, DURATION_MS));

clearInterval(report);
for (const ws of sockets) ws.close();
console.log('Final:', stats);
process.exit(0);
