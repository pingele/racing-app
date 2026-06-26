import db from '../db/connection.js';
import { asyncHandler } from '../middleware/index.js';

const leaderboardStmt = db.prepare(`
  SELECT
    u.id AS user_id,
    u.display_name,
    COALESCE(SUM(p.points_awarded), 0) AS total_points,
    COUNT(p.id) AS picks_made,
    SUM(CASE WHEN p.scored_at IS NOT NULL THEN 1 ELSE 0 END) AS picks_scored
  FROM users u
  LEFT JOIN picks p ON p.user_id = u.id
  GROUP BY u.id
  ORDER BY total_points DESC, picks_scored DESC, u.display_name ASC
`);

// GET /api/leaderboard — ranked users by total points.
export const getLeaderboard = asyncHandler(async (req, res) => {
  const rows = leaderboardStmt.all();
  const leaderboard = rows.map((row, i) => ({ rank: i + 1, ...row }));
  res.json({ leaderboard });
});
