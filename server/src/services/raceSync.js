import db from '../db/connection.js';
import { getRaceProvider } from './providerFactory.js';
import { scoreRace } from './scoring.js';

// Upsert a single race plus its drivers from the provider into SQLite.
const upsertRace = db.prepare(`
  INSERT INTO races (external_id, name, series, track, start_time, status, synced_at)
  VALUES (@external_id, @name, @series, @track, @start_time, @status, datetime('now'))
  ON CONFLICT(external_id) DO UPDATE SET
    name=excluded.name, series=excluded.series, track=excluded.track,
    start_time=excluded.start_time, status=excluded.status, synced_at=datetime('now')
`);

const getRaceByExternal = db.prepare('SELECT * FROM races WHERE external_id = ?');

const upsertDriver = db.prepare(`
  INSERT INTO drivers (race_id, external_id, number, name, active)
  VALUES (@race_id, @external_id, @number, @name, @active)
  ON CONFLICT(race_id, external_id) DO UPDATE SET
    number=excluded.number, name=excluded.name, active=excluded.active
`);

const getDriverByExternal = db.prepare(
  'SELECT * FROM drivers WHERE race_id = ? AND external_id = ?'
);

const upsertResult = db.prepare(`
  INSERT INTO race_results (race_id, driver_id, finish_position, status, laps, best_lap_time, last_lap_time, total_time)
  VALUES (@race_id, @driver_id, @finish_position, @status, @laps, @best_lap_time, @last_lap_time, @total_time)
  ON CONFLICT(race_id, driver_id) DO UPDATE SET
    finish_position=excluded.finish_position, status=excluded.status,
    laps=excluded.laps, best_lap_time=excluded.best_lap_time,
    last_lap_time=excluded.last_lap_time, total_time=excluded.total_time
`);

async function syncRaceDrivers(provider, externalId, raceRow) {
  const drivers = await provider.getDrivers(externalId);
  const tx = db.transaction(() => {
    for (const d of drivers) {
      upsertDriver.run({
        race_id: raceRow.id,
        external_id: d.external_id,
        number: d.number ?? null,
        name: d.name,
        active: d.active ? 1 : 0,
      });
    }
  });
  tx();
}

async function syncRaceResults(provider, externalId, raceRow) {
  const results = await provider.getResults(externalId);
  if (!results || results.length === 0) return false;
  const tx = db.transaction(() => {
    for (const r of results) {
      const driver = getDriverByExternal.get(raceRow.id, r.driver_external_id);
      if (!driver) continue;
      upsertResult.run({
        race_id: raceRow.id,
        driver_id: driver.id,
        finish_position: r.finish_position,
        status: r.status ?? null,
        laps: r.laps ?? null,
        best_lap_time: r.best_lap_time ?? null,
        last_lap_time: r.last_lap_time ?? null,
        total_time: r.total_time ?? null,
      });
    }
  });
  tx();
  return true;
}

// Sync race metadata (name, series, track, start_time, status) for every race
// the provider knows about. Drivers and results are NOT fetched here -- they
// are pulled lazily by syncRace() when a user opens a specific race, which
// avoids hundreds of extra API calls on every races-list page load.
export async function syncAllRaces() {
  const provider = getRaceProvider();
  const races = await provider.listRaces();
  const tx = db.transaction(() => {
    for (const race of races) {
      upsertRace.run({
        external_id: race.external_id,
        name: race.name,
        series: race.series ?? null,
        track: race.track ?? null,
        start_time: race.start_time ?? null,
        status: race.status ?? 'scheduled',
      });
    }
  });
  tx();
  return races.length;
}

// Sync a single race on demand (used when opening a race detail page).
export async function syncRace(externalId) {
  const provider = getRaceProvider();
  const race = await provider.getRace(externalId);
  if (!race) return null;
  upsertRace.run({
    external_id: race.external_id,
    name: race.name,
    series: race.series ?? null,
    track: race.track ?? null,
    start_time: race.start_time ?? null,
    status: race.status ?? 'scheduled',
  });
  const raceRow = getRaceByExternal.get(race.external_id);
  await syncRaceDrivers(provider, race.external_id, raceRow);
  if (race.status === 'finished') {
    const hasResults = await syncRaceResults(provider, race.external_id, raceRow);
    if (hasResults) scoreRace(raceRow.id);
  }
  return raceRow;
}
