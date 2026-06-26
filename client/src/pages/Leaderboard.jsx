import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .leaderboard()
      .then((data) => setRows(data.leaderboard))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading leaderboard...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1>Leaderboard</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Points</th>
            <th>Picks Scored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} className={user && r.user_id === user.id ? 'me-row' : ''}>
              <td>{r.rank}</td>
              <td>{r.display_name}</td>
              <td>{r.total_points}</td>
              <td>{r.picks_scored}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
