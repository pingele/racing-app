import db from '../db/connection.js';

const getPointsForPosition = db.prepare(
  'SELECT points FROM scoring_rules WHERE finish_position = ?'
);

const getUnscoredPicks = db.prepare(`
  SELECT p.id AS pick_id, p.driver_id
  FROM picks p
  WHERE p.race_id = ? AND p.scored_at IS NULL
`);

const getResultForDriver = db.prepare(
  'SELECT finish_position FROM race_results WHERE race_id = ? AND driver_id = ?'
);

const updatePickScore = db.prepare(`
  UPDATE picks SET points_awarded = ?, scored_at = datetime('now') WHERE id = ?
`);

// Map a finishing position to points via the configurable scoring_rules table.
// Positions outside the table earn 0.
export function pointsForPosition(position) {
  if (position == null) return 0;
  const row = getPointsForPosition.get(position);
  return row ? row.points : 0;
}

// Score all unscored picks for a finished race.
export function scoreRace(raceId) {
  const picks = getUnscoredPicks.all(raceId);
  const tx = db.transaction(() => {
    for (const pick of picks) {
      const result = getResultForDriver.get(raceId, pick.driver_id);
      const position = result ? result.finish_position : null;
      const points = pointsForPosition(position);
      updatePickScore.run(points, pick.pick_id);
    }
  });
  tx();
  return picks.length;
}
