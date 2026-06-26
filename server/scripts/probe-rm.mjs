// Diagnostic: probe Race Monitor /v2/Account/* endpoints with the configured key.
// Run from server/: node scripts/probe-rm.mjs
import 'dotenv/config';

const token = process.env.RACE_MONITOR_TOKEN;
const base = process.env.RACE_MONITOR_BASE_URL || 'https://api.race-monitor.com';

if (!token) {
  console.error('RACE_MONITOR_TOKEN not set in server/.env');
  process.exit(1);
}

async function probe(path, extra = {}) {
  const body = new URLSearchParams({ apiToken: token, ...extra });
  const res = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    return { path, http: res.status, error: 'non-JSON response' };
  }
  return { path, http: res.status, payload, extra };
}

function summarize(r) {
  const { path, http, payload, extra, error } = r;
  if (error) return { path, http, error };
  const p = payload || {};
  const summary = { path, http, Successful: p.Successful };
  if (p.Message) summary.Message = p.Message;
  if (extra && Object.keys(extra).length) summary.params = extra;
  for (const key of ['Races', 'Series', 'Sessions', 'Race']) {
    if (Array.isArray(p[key])) {
      summary[`${key}.length`] = p[key].length;
      if (p[key].length) {
        const sample = p[key][0];
        summary[`${key}[0].keys`] = Object.keys(sample).slice(0, 12);
        if (key === 'Races' && sample) {
          summary[`${key}[0].sample`] = {
            ID: sample.ID,
            Name: sample.Name,
            StartDateEpoc: sample.StartDateEpoc,
            SeriesID: sample.SeriesID,
            Track: sample.Track,
            HasResults: sample.HasResults,
          };
        }
        if (key === 'Series' && sample) {
          summary[`${key}[0].sample`] = { ID: sample.ID, Name: sample.Name };
        }
      }
    } else if (p[key] && typeof p[key] === 'object') {
      summary[`${key}.keys`] = Object.keys(p[key]).slice(0, 12);
    }
  }
  return summary;
}

const endpoints = [
  ['/v2/Common/UpcomingRaces'],
  ['/v2/Common/CurrentRaces'],
  ['/v2/Common/PastRaces'],
  ['/v2/Common/RaceTypes'],
];

const results = [];
for (const [path, extra] of endpoints) {
  try {
    results.push(summarize(await probe(path, extra)));
  } catch (e) {
    results.push({ path, error: e.message });
  }
}

// If Series returned anything, probe AllRaces filtered by the first seriesID
const seriesResult = results.find((r) => r.path === '/v2/Account/Series');
const firstSeriesId = seriesResult && seriesResult['Series[0].sample']?.ID;
if (firstSeriesId) {
  try {
    results.push(
      summarize(await probe('/v2/Account/AllRaces', { seriesID: firstSeriesId }))
    );
    results.push(
      summarize(await probe('/v2/Account/UpcomingRaces', { seriesID: firstSeriesId }))
    );
  } catch (e) {
    results.push({ path: 'filtered probes', error: e.message });
  }
}

console.log(JSON.stringify(results, null, 2));
