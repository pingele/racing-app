# Racing Prediction PWA

A Progressive Web App where users register, log in, browse races, predict a race winner
from the active drivers, and earn position-based points based on where their pick finishes.

## Stack
- **Frontend:** ReactJS (Vite) — installable PWA, hosted on AWS Amplify Hosting
- **Auth:** Amazon Cognito (email + password) via Amplify Auth
- **Data:** AWS AppSync (GraphQL) + Amazon DynamoDB via Amplify Data
- **Race sync:** Scheduled AWS Lambda (`amplify/functions/sync-races`) — every 15 min
- **Race data:** Race Monitor API via a provider abstraction (mock implementation
  included; real API token plugs in via Amplify Function secrets)

## Structure
```
racing-app/
  amplify/      Amplify Gen 2 backend (auth, data, scheduled sync function)
  amplify.yml   Amplify Hosting build spec
  client/       React PWA (Vite)
  server/       Legacy Express + SQLite (local-dev / reference only — not deployed)
```

> The `server/` directory is the legacy single-host Express + SQLite backend
> from the original Azure App Service deploy. It is no longer used in
> production — Amplify Gen 2 replaces it with Cognito + AppSync + DynamoDB.
> Keep it for local reference or delete it when you're satisfied with the
> Amplify backend.

## Local development

### 1. Install dependencies
```bash
npm install
npm --prefix client install
```

### 2. Start the Amplify cloud sandbox
Provisions a per-developer Cognito user pool, AppSync API, DynamoDB tables, and
the scheduled sync Lambda. Writes `amplify_outputs.json` at the repo root, which
the client imports automatically.

```bash
npx ampx sandbox
```

Leave this running. The sandbox watches `amplify/` and redeploys on change.

### 3. Run the React PWA
In a second terminal:

```bash
npm --prefix client run dev    # http://localhost:5173
```

### 4. (Optional) Switch the sync function to Race Monitor
1. Set the secret once: `npx ampx sandbox secret set RACE_MONITOR_TOKEN`
2. Uncomment the `secrets` block in `amplify/functions/sync-races/resource.ts`
3. Set `RACE_PROVIDER=racemonitor` in that function's environment.
4. Implement the real fetch logic inside `loadRaces()` in `handler.ts`
   (port from `server/src/services/RaceMonitorProvider.js`).

## Deploying to AWS Amplify Hosting

1. Push this repo to GitHub.
2. In the [AWS Amplify console](https://console.aws.amazon.com/amplify/), create
   a new app → "Host web app" → connect the repo + branch.
3. Amplify will auto-detect `amplify.yml`. Confirm the build settings.
4. The pipeline runs `ampx pipeline-deploy` (provisions the backend) then
   `npm --prefix client run build` (publishes the static frontend).

After the first deploy, Amplify Hosting injects `amplify_outputs.json` into the
build environment so the client picks up the right Cognito/AppSync wiring.

## Scoring
Scoring is **position-based** (F1-style defaults: 1st=25, 2nd=18, ...) and stored in
the `ScoringRule` model. The scheduled sync function seeds the default table on
first run and re-scores any newly-finished races. Point values can be edited
directly in the DynamoDB-backed `ScoringRule` table.

## Product rules
- One winner pick per user, per race (enforced client-side; consider adding a
  custom AppSync validator for hard uniqueness if abuse becomes a concern).
- Picks lock client-side once the race status flips to `finished`.
- Results sync from the race provider on a schedule; picks are then scored
  automatically by the same Lambda.

## Race Monitor integration
The Race Monitor API (https://www.race-monitor.com/APIDocs) requires an API
token and its docs are behind a login. The scheduled Lambda
(`amplify/functions/sync-races/handler.ts`) currently uses the bundled mock
provider. To switch to the real API, follow step 4 of "Local development"
above.
