import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function MyPicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listPicks()
      .then((data) => setPicks(data.picks))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading your picks...</p>;
  if (error) return <p className="error">{error}</p>;

  const total = picks.reduce((sum, p) => sum + (p.points_awarded || 0), 0);

  return (
    <section>
      <h1>My Picks</h1>
      <p className="muted">Total points: <strong>{total}</strong></p>
      {picks.length === 0 ? (
        <p>
          You haven&apos;t made any picks yet. <Link to="/races">Browse races</Link>.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Race</th>
              <th>Status</th>
              <th>Your Pick</th>
              <th>Finish</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/races/${p.race_id}`}>{p.race_name}</Link>
                </td>
                <td>
                  <StatusBadge status={p.race_status} />
                </td>
                <td>
                  #{p.driver_number} {p.driver_name}
                </td>
                <td>{p.finish_position ? `P${p.finish_position}` : '—'}</td>
                <td>{p.points_awarded != null ? p.points_awarded : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
