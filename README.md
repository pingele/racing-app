# Racing Prediction PWA

A Progressive Web App where users register, log in, browse races, predict a race winner
from the active drivers, and earn position-based points based on where their pick finishes.

## Stack
- **Frontend:** ReactJS (Vite) — installable PWA
- **Backend:** Node.js + Express REST API
- **Database:** SQLite
- **Auth:** Email + password, JWT sessions (bcrypt-hashed passwords)
- **Race data:** Race Monitor API via a provider abstraction (mock implementation included;
  real API token plugs in later through env config)

## Structure
```
racing-app/
  server/   Express API + SQLite
  client/   React PWA (Vite)
```

## Getting started

### Server
```bash
cd server
cp .env.example .env
npm install
npm run seed     # create + seed the SQLite database
npm run dev      # start API on http://localhost:4000
```

### Client
```bash
cd client
npm install
npm run dev      # start PWA on http://localhost:5173
```

## Scoring
Scoring is **position-based** (F1-style defaults: 1st=25, 2nd=18, ...) and stored in a
configurable `scoring_rules` table, so point values can be changed without code edits.

## Product rules
- One winner pick per user, per race.
- A pick **locks once the race starts**.
- Results are synced from the race provider; picks are then scored automatically.

## Race Monitor integration
The Race Monitor API (https://www.race-monitor.com/APIDocs) requires an API token and its
docs are behind a login. The app talks to a `RaceProvider` interface. A `MockRaceProvider`
runs the full app without credentials. Set `RACE_PROVIDER=racemonitor` and
`RACE_MONITOR_TOKEN=...` in `server/.env` to switch to the real provider once available.
