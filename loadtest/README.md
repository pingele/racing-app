# Load-testing harness

Tools to load test the racing app for up to ~2000 simultaneous users. The app
is **CloudFront/S3 → AppSync GraphQL → DynamoDB**, with **Cognito** auth and
**AppSync realtime (WebSocket)** subscriptions (the standings leaderboard). The
static frontend scales trivially; this harness targets the parts that don't:
authenticated GraphQL, and concurrent subscriptions + their fan-out.

## ⚠️ Before you start

- **Run against a dedicated, throwaway backend — never production.** The scripts
  read `../amplify_outputs.json`, so stand up an isolated backend first
  (`npx ampx sandbox` or a dedicated branch deploy) and use its output. A
  throttled or melted DynamoDB table should never affect real users.
- It's still real AWS infrastructure (account `311464444705`, `us-east-1`), and
  on-demand DynamoDB + per-request AppSync + WebSocket minutes cost money. Tear
  down when done.
- Check Service Quotas ahead of time and request increases if needed: AppSync
  requests/sec and concurrent WebSocket connections, Cognito `InitiateAuth`/sec,
  DynamoDB throughput.
- Generated files (`users.json`, `tokens.json`, …) contain test-account tokens
  and are git-ignored. Don't commit them.

## Prerequisites

- Node 24 and AWS credentials with admin on the throwaway backend's Cognito pool
  and DynamoDB tables.
- [k6](https://k6.io/docs/get-started/installation/) for the HTTP tier.
- `npm install` in this directory (pulls the AWS SDK + `ws`).

## Steps

```bash
cd loadtest
npm install

# 1. Create test users (default 2000) and mint their ID tokens.
LT_USERS=2000 npm run users
npm run tokens            # writes tokens.json (tokens expire ~1h — mint fresh before a run)

# 2. Seed realistic data so standings()/getRace() do real work.
npm run seed              # 12 races × 4 classes × 22 entries + ~preds per user

# 3a. HTTP load: ramp to 2000 VUs with a read-heavy journey.
k6 run -e LT_GRAPHQL_URL="$(node -e "console.log(require('../amplify_outputs.json').data.url)")" \
       -e LT_VUS=2000 -e LT_RAMP=3m -e LT_HOLD=5m journey.js

# 3b. Subscription load: hold connections, then generate fan-out in another shell.
LT_SUBS=500 LT_SUBS_DURATION_S=300 npm run subs
#   ...in a second terminal, while subs are held:
LT_FIRE=50 npm run fire

# 4. Clean up Cognito users + the dedicated client (delete the sandbox for data).
npm run teardown
```

## What each script does

| Script | Purpose |
|---|---|
| `create-users.mjs` | Bulk-creates confirmed Cognito users with permanent passwords (idempotent). → `users.json` |
| `mint-tokens.mjs` | Creates a **dedicated** app client with `USER_PASSWORD_AUTH` (leaves your app's SRP client untouched) and pre-mints ID tokens. → `tokens.json` |
| `seed.mjs` | Writes races/classes/entries/predictions **directly to DynamoDB** for volume. → `seed-manifest.json` |
| `journey.js` | k6: read-heavy GraphQL journey (60% browse, 30% standings, 10% write), ramps to `LT_VUS`. |
| `hold-subscriptions.mjs` | Holds `LT_SUBS` raw AppSync-realtime WebSocket subscriptions (the leaderboard's `observeQuery` path) and reports connect/event counts. |
| `fire-events.mjs` | Creates+updates predictions to generate subscription fan-out while subs are held. |
| `teardown.mjs` | Deletes the test users + dedicated app client. |

## Key tunables (env vars)

`LT_USERS`, `LT_PASSWORD`, `LT_EMAIL_DOMAIN` · `LT_RACES`, `LT_CLASSES_PER_RACE`,
`LT_ENTRIES_PER_CLASS`, `LT_PREDS_PER_USER`, `LT_COMPLETED_RATIO` ·
`LT_VUS`, `LT_RAMP`, `LT_HOLD` · `LT_SUBS`, `LT_SUBS_DURATION_S` · `LT_FIRE`.

## Watch these while running (CloudWatch)

- **AppSync**: `4XXError`, `5XXError`, `Latency`, connect/subscribe counts.
- **DynamoDB**: `ThrottledRequests`, `ConsumedReadCapacityUnits` per table.
- **Cognito**: throttling on `InitiateAuth`.
- Correlate server-side spikes with k6's `p(95)`/`p(99)` and the custom
  `standings_latency` / `race_bundle_latency` trends.

## Expected first bottleneck

`standings()` and the leaderboard both read the **entire** `Prediction` table —
`standings()` on every view, the leaderboard as a live subscription per client.
At 2000 users that's thousands of full-table reads plus a subscription fan-out
to every client on each scoring write. Expect this to surface first (rising
`standings_latency`, DynamoDB read throttles, subscription event storms). The
fix is caching or a materialized standings/leaderboard row rather than
re-scanning `Prediction` per request.

## Gotchas

- **Tokens rejected as Unauthorized?** AppSync may be configured to accept only
  the app's own client id. Enable `USER_PASSWORD_AUTH` on that client and run
  `LT_USE_APP_CLIENT=1 npm run tokens`.
- **Can't find DynamoDB tables?** Override with
  `LT_TABLE_RACE` / `LT_TABLE_RACECLASS` / `LT_TABLE_ENTRY` / `LT_TABLE_PREDICTION`.
- **Cognito throttling while minting tokens** is normal at volume — the scripts
  retry with backoff. Mint once and reuse `tokens.json` within the hour.
