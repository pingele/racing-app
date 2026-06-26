import db from '../db/connection.js';
import { asyncHandler, HttpError } from '../middleware/index.js';
import { syncAllRaces, syncRace } from '../services/raceSync.js';
import { getRaceProvider } from '../services/providerFactory.js';

const listRacesStmt = db.prepare(
  'SELECT * FROM races WHERE start_time >= ? AND start_time < ? ORDER BY start_time ASC'
);
const getRaceStmt = db.prepare('SELECT * FROM races WHERE id = ?');

// Monday 00:00 local through next Monday 00:00 local, returned as ISO/UTC.
function currentWeekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = start.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}
const getDriversStmt = db.prepare(
  'SELECT * FROM drivers WHERE race_id = ? ORDER BY CAST(number AS INTEGER) ASC'
);
const getResultsStmt = db.prepare(`
  SELECT r.finish_position, r.status, r.laps, r.best_lap_time, r.last_lap_time, r.total_time,
         d.id AS driver_id, d.name, d.number
  FROM race_results r JOIN drivers d ON d.id = r.driver_id
  WHERE r.race_id = ? ORDER BY r.finish_position ASC
`);

// GET /api/races — return races scheduled for the current week (Mon–Sun).
export const listRaces = asyncHandler(async (req, res) => {
  await syncAllRaces();
  const { start, end } = currentWeekRange();
  res.json({ races: listRacesStmt.all(start, end) });
});

// GET /api/races/:id — race detail with drivers and (if finished) results.
export const getRace = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  let race = getRaceStmt.get(id);
  if (!race) throw new HttpError(404, 'Race not found');
  // Refresh this race from the provider (picks up status/result changes).
  await syncRace(race.external_id);
  race = getRaceStmt.get(id);
  const drivers = getDriversStmt.all(id);
  const results = race.status === 'finished' ? getResultsStmt.all(id) : [];
  res.json({ race, drivers, results });
});

// POST /api/races/sync — manually trigger a provider sync.
export const syncRaces = asyncHandler(async (req, res) => {
  const count = await syncAllRaces();
  res.json({ synced: count });
});

// POST /api/races/sync/:externalId — sync a single race from the provider on
// demand (used by the calendar page so un-imported races become clickable).
export const syncRaceOnDemand = asyncHandler(async (req, res) => {
  const externalId = String(req.params.externalId);
  const row = await syncRace(externalId);
  if (!row) throw new HttpError(404, 'Race not found in provider');
  res.json({ race: row });
});

// GET /api/races/calendar — live calendar from the race provider (no DB).
// Returns provider Race objects (external_id, name, series, track, start_time, status).
export const getCalendar = asyncHandler(async (req, res) => {
  const provider = getRaceProvider();
  const races = await provider.getCalendar();
  const sorted = [...races].sort((a, b) => {
    const at = a.start_time ? Date.parse(a.start_time) : Number.POSITIVE_INFINITY;
    const bt = b.start_time ? Date.parse(b.start_time) : Number.POSITIVE_INFINITY;
    return at - bt;
  });
  res.json({ races: sorted });
});

// GET /api/races/:id/sessions — list selectable timing sessions (classes/heats)
// for this race straight from the provider.
export const listSessions = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const race = getRaceStmt.get(id);
  if (!race) throw new HttpError(404, 'Race not found');
  const provider = getRaceProvider();
  const sessions = (await provider.getSessions(race.external_id)) ?? [];
  res.json({ sessions });
});

// GET /api/races/:id/sessions/:sessionId — live results for one timing
// session (does not hit the DB; competitor name + number are inlined).
export const getSessionResults = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const race = getRaceStmt.get(id);
  if (!race) throw new HttpError(404, 'Race not found');
  const provider = getRaceProvider();
  const results = (await provider.getSessionResults(race.external_id, req.params.sessionId)) ?? [];
  res.json({ results });
});
