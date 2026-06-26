// Diagnostic: explore /v2/Results/* fields for a finished race.
// Usage: node --env-file=server/.env server/scripts/probe-results.mjs <raceID>
import 'dotenv/config';

const token = process.env.RACE_MONITOR_TOKEN;
const base = process.env.RACE_MONITOR_BASE_URL || 'https://api.race-monitor.com';
const raceID = Number(process.argv[2]);

if (!token || !raceID) {
  console.error('Usage: probe-results.mjs <raceID> (and RACE_MONITOR_TOKEN must be set)');
  process.exit(1);
}

async function post(path, extra = {}) {
  const body = new URLSearchParams({ apiToken: token, ...extra });
  const res = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const text = await res.text();
  try {
    return { http: res.status, json: JSON.parse(text) };
  } catch {
    return { http: res.status, html: text.slice(0, 120) };
  }
}

const sessionsRes = await post('/v2/Results/SessionsForRace', { raceID });
console.log('--- SessionsForRace ---');
console.log(JSON.stringify(sessionsRes, null, 2).slice(0, 2000));

const sessionID = sessionsRes.json?.Sessions?.[0]?.ID;
if (!sessionID) {
  console.error('No sessions for race; stopping.');
  process.exit(0);
}
console.log('\nUsing sessionID:', sessionID);

const details = await post('/v2/Results/SessionDetails', { sessionID });
console.log('\n--- SessionDetails: top-level keys ---');
console.log(Object.keys(details.json?.Session ?? {}));
const comp0 = details.json?.Session?.SortedCompetitors?.[0];
console.log('\nSortedCompetitors[0] keys:', Object.keys(comp0 ?? {}));
console.log('Sample competitor:', JSON.stringify(comp0, null, 2));

const competitorID = comp0?.ID;
if (competitorID) {
  const cd = await post('/v2/Results/CompetitorDetails', { sessionID, competitorID });
  console.log('\n--- CompetitorDetails (sessionID,competitorID) ---');
  console.log(JSON.stringify(cd, null, 2).slice(0, 2500));
}

const grouped = await post('/v2/Results/GroupedSessionsForRace', { raceID });
console.log('\n--- GroupedSessionsForRace ---');
console.log(JSON.stringify(grouped, null, 2).slice(0, 1200));

const racer = await post('/v2/Results/RacerResultsForRace', { raceID });
console.log('\n--- RacerResultsForRace ---');
console.log(JSON.stringify(racer, null, 2).slice(0, 1500));
