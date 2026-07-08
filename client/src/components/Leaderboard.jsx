import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useStandings } from '../context/StandingsContext.jsx';

// Compact top-5 standings shown as a left rail on web and a strip across the top
// of the screen on mobile. Updates live as races are scored (see
// StandingsProvider). Hidden until there's at least one scored prediction.
export default function Leaderboard() {
  const { user } = useAuth();
  const { top, loading, error } = useStandings();

  // Stay out of the way on error or before any points exist — the full
  // Standings page is always available from the nav.
  if (error) return null;
  if (!loading && top.length === 0) return null;

  return (
    <aside className="leaderboard card" aria-label="Top 5 standings">
      <div className="leaderboard-head">
        <h2>Top 5</h2>
        <Link to="/standings" className="leaderboard-all">
          Full standings
        </Link>
      </div>
      {loading ? (
        <p className="muted leaderboard-empty">Loading…</p>
      ) : (
        <ol className="leaderboard-list">
          {top.map((row) => (
            <li
              key={row.userId}
              className={`leaderboard-item${row.userId === user?.id ? ' me' : ''}`}
            >
              <span className="leaderboard-rank">{row.rank}</span>
              <span className="leaderboard-name">{row.displayName}</span>
              <span className="leaderboard-pts">{row.totalPoints}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
