import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Races() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listRaces()
      .then(setRaces)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading races...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Races</h1>
      <p className="muted">
        Pick a race, then predict the finishing order of each class.
      </p>
      {races.length === 0 ? (
        <div className="card info">
          <p className="muted">
            No races imported yet. An admin can pull one in from the Admin screen.
          </p>
        </div>
      ) : (
        <div className="race-grid">
          {races.map((r) => (
            <Link key={r.id} to={`/races/${r.id}`} className="race-card card">
              <div className="race-card-head">
                <h3>{r.name}</h3>
                <span
                  className={`badge ${
                    r.status === 'completed' ? 'badge-finished' : 'badge-scheduled'
                  }`}
                >
                  {r.status === 'completed' ? 'Results in' : 'Open'}
                </span>
              </div>
              <div className="race-meta">
                {r.track && <span>{r.track}</span>}
                {r.location && <span>{r.location}</span>}
                <span>{formatDate(r.eventDate)}</span>
              </div>
              {r.predictionsLocked && (
                <div className="race-time">🔒 Predictions locked</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
