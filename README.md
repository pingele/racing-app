# MyRacePass Predictor

A web app where users predict the **finishing order of each class** in a dirt-track
race night and earn F1-style points. Race data is scraped from
[MyRacePass](https://www.myracepass.com) on demand by an admin.

## What it does
- **Admin** enters a MyRacePass numeric **event ID** and clicks **Import Race
  Details** — the app scrapes the event's details, classes, and entries.
- **Users** open a race and arrange the **full finishing order** of every entry in
  each class (their #1 is their predicted winner).
- **Admin** locks predictions, then clicks **Import Results** after the race —
  the app scrapes the A-Feature results and **scores** each prediction.
- **Scoring (F1-style):** a configurable points table (1→25, 2→18, 3→15, … 10→1).
  An entry earns `points(p)` when the user placed it at the exact position `p`
  it actually finished. Scores are tracked **per event** and as a **running
  total** on the Standings page.

## Stack
- **Frontend:** React (Vite), hosted on AWS Amplify Hosting. Opens on the Races
  page; the Admin screen is gated behind the `Admins` Cognito group.
- **Auth:** Amazon Cognito (email + password) via Amplify Auth. A post-confirmation
  trigger auto-promotes a configured admin email into the `Admins` group.
- **Data:** AWS AppSync (GraphQL) + Amazon DynamoDB via Amplify Data.
- **Scraping + scoring:** an on-demand Lambda (`amplify/functions/scrape-race`)
  exposed as the admin-only `importRaceDetails` / `importRaceResults` custom
  mutations. It fetches MyRacePass pages, parses them with `cheerio`, upserts to
  DynamoDB, and scores predictions on results import.

## Structure
```
racing-app/
  amplify/
    auth/                     Cognito (email login, Admins group, triggers)
    data/resource.ts          Race / RaceClass / Entry / RaceResult /
                              Prediction / ScoringRule / UserProfile + mutations
    functions/scrape-race/    on-demand scraper + scorer Lambda
      handler.ts              branches on importRaceDetails / importRaceResults
      myracepass.ts           cheerio parsers (details / entries / results)
  amplify.yml                 Amplify Hosting build spec
  client/                     React app (Vite)
```

### MyRacePass scraping
MyRacePass is server-rendered HTML, scraped from public pages:
- `/events/{id}` — event name, track, date.
- `/events/{id}/entries` — classes and their entries (driver, car #, hometown).
- `/events/{id}/races` — per-class session results; the **A-Feature** is taken as
  the official finishing order used for scoring.

## Local development

> Requires **Node 20+** and AWS credentials configured for the Amplify sandbox.

### 1. Install dependencies
```bash
npm install
npm --prefix client install
```

### 2. Start the Amplify cloud sandbox
Provisions a per-developer Cognito user pool (with the `Admins` group + triggers),
AppSync API, DynamoDB tables, and the `scrape-race` Lambda. Writes
`amplify_outputs.json` at the repo root, which the client imports automatically.
```bash
npx ampx sandbox
```
Leave it running; it watches `amplify/` and redeploys on change.

### 3. Run the React app
```bash
npm --prefix client run dev      # http://localhost:5173
```

### 4. Bootstrap the admin
Register with the admin email (default `eric.pingel@gmail.com`, configurable via
the `ADMIN_EMAIL` env on `amplify/auth/post-confirmation/resource.ts`). The
post-confirmation trigger adds it to the `Admins` group, and the **Admin** nav
link appears. Everyone else signs up as a regular predictor.

## Deploying to AWS Amplify Hosting
1. Push to GitHub.
2. In the [AWS Amplify console](https://console.aws.amazon.com/amplify/), create an
   app → "Host web app" → connect the repo + branch. Amplify auto-detects
   `amplify.yml` (runs `ampx pipeline-deploy`, then builds the client).

## Try it
Sample finished event for `Import Results`: **614370** (Camden Speedway). Sample
upcoming/open event for entries-only: **614394**.
