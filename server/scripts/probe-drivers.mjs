// Diagnostic: try multiple endpoints to find a pre-race competitor list.
import 'dotenv/config';

const token = process.env.RACE_MONITOR_TOKEN;
const base = process.env.RACE_MONITOR_BASE_URL || 'https://api.race-monitor.com';
const raceID = Number(process.argv[2] ?? 166702);

if (!token) {
  console.error('RACE_MONITOR_TOKEN not set');
  process.exit(1);
}

async function probe(path, extra = {}) {
  const body = new URLSearchParams({ apiToken: token, ...extra });
  try {
    const res = await fetch(new URL(path, base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const payload = await res.json();
    return { path, http: res.status, payload };
  } catch (e) {
    return { path, error: e.message };
  }
}

function summarize(r) {
  if (r.error) return { path: r.path, error: r.error };
  const p = r.payload || {};
  const out = { path: r.path, http: r.http, Successful: p.Successful, Message: p.Message };
  for (const k of Object.keys(p)) {
    if (k === 'Successful' || k === 'Message') continue;
    const v = p[k];
    if (Array.isArray(v)) {
      out[`${k}.length`] = v.length;
      if (v.length) out[`${k}[0].keys`] = Object.keys(v[0] ?? {}).slice(0, 20);
    } else if (v && typeof v === 'object') {
      out[`${k}.keys`] = Object.keys(v).slice(0, 30);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const targets = [
  ['/v2/Race/RaceDetails', { raceID }],
  ['/v2/Results/SessionsForRace', { raceID }],
  ['/v2/Results/GroupedSessionsForRace', { raceID }],
  ['/v2/Results/RecentResults', { raceID }],
  ['/v2/Results/RacerResultsForRace', { raceID }],
  ['/v2/Live/CurrentSession', { raceID }],
  ['/v2/Live/CurrentSessionDetails', { raceID }],
  ['/v2/Live/Race', { raceID }],
  ['/v2/Live/RaceDetails', { raceID }],
  ['/v2/Race/Competitors', { raceID }],
  ['/v2/Race/Drivers', { raceID }],
  ['/v2/Race/IsLive', { raceID }],
];

const results = [];
for (const [p, extra] of targets) {
  results.push(summarize(await probe(p, extra)));
}
console.log(JSON.stringify(results, null, 2));
