import { z } from 'zod';
import db from '../db/connection.js';
import { asyncHandler, HttpError } from '../middleware/index.js';

export const createPickSchema = z.object({
  driverId: z.number().int().positive(),
});

const getRaceStmt = db.prepare('SELECT * FROM races WHERE id = ?');
const getDriverStmt = db.prepare('SELECT * FROM drivers WHERE id = ? AND race_id = ?');
const getExistingPick = db.prepare('SELECT * FROM picks WHERE user_id = ? AND race_id = ?');
const insertPick = db.prepare(
  'INSERT INTO picks (user_id, race_id, driver_id) VALUES (?, ?, ?)'
);

const listUserPicks = db.prepare(`
  SELECT
    p.id, p.race_id, p.driver_id, p.created_at, p.points_awarded, p.scored_at,
    r.name AS race_name, r.status AS race_status, r.start_time,
    d.name AS driver_name, d.number AS driver_number,
    res.finish_position
  FROM picks p
  JOIN races r ON r.id = p.race_id
  JOIN drivers d ON d.id = p.driver_id
  LEFT JOIN race_results res ON res.race_id = p.race_id AND res.driver_id = p.driver_id
  WHERE p.user_id = ?
  ORDER BY r.start_time DESC
`);

// A pick is locked only after the race has finished. Live/in-progress races
// remain pickable.
function isRaceLocked(race) {
  return race.status === 'finished';
}

// POST /api/races/:raceId/picks — pick a winner for a race.
export const createPick = asyncHandler(async (req, res) => {
  const raceId = Number(req.params.raceId);
  const { driverId } = req.body;
  const race = getRaceStmt.get(raceId);
  if (!race) throw new HttpError(404, 'Race not found');
  if (isRaceLocked(race)) {
    throw new HttpError(409, 'Picks are locked because the race has finished');
  }
  const driver = getDriverStmt.get(driverId, raceId);
  if (!driver) throw new HttpError(400, 'Driver is not part of this race');
  if (getExistingPick.get(req.user.id, raceId)) {
    throw new HttpError(409, 'You have already picked a winner for this race');
  }
  const info = insertPick.run(req.user.id, raceId, driverId);
  res.status(201).json({
    pick: { id: info.lastInsertRowid, raceId, driverId },
  });
});

// GET /api/races/:raceId/picks/me — current user's pick for a race (or null).
export const getMyPickForRace = asyncHandler(async (req, res) => {
  const raceId = Number(req.params.raceId);
  const pick = getExistingPick.get(req.user.id, raceId);
  res.json({ pick: pick || null });
});

// GET /api/picks — all of the current user's picks.
export const listPicks = asyncHandler(async (req, res) => {
  res.json({ picks: listUserPicks.all(req.user.id) });
});
