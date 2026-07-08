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

const isScored = (r) => r.status === 'completed';

// A prominent, clickable race card used in the "to predict" and "scored" rows.
function RaceCard({ race }) {
  const scored = isScored(race);
  return (
    <Link to={`/races/${race.id}`} className="race-card card">
      <div className="race-card-head">
        <h3>{race.name}</h3>
        <span className={`badge ${scored ? 'badge-finished' : 'badge-scheduled'}`}>
          {scored ? 'Results in' : 'Open'}
        </span>
      </div>
      <div className="race-meta">
        {race.track && <span>{race.track}</span>}
        {race.location && <span>{race.location}</span>}
        <span>{formatDate(race.eventDate)}</span>
      </div>
      {!scored && race.predictionsLocked && (
        <div className="race-time">🔒 Predictions locked — awaiting results</div>
      )}
    </Link>
  );
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

  // Open races (still to be predicted) float to the top; scoring a race moves it
  // down into the "scored" row. listRaces() already sorts newest-first.
  const toPredict = races.filter((r) => !isScored(r));
  const scored = races.filter(isScored);

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
        <>
          <section className="races-section">
            <div className="races-section-head">
              <h2>To predict</h2>
              <span className="races-count">{toPredict.length}</span>
            </div>
            {toPredict.length === 0 ? (
              <p className="muted">
                Nothing open right now — every race has been scored.
              </p>
            ) : (
              <div className="race-grid">
                {toPredict.map((r) => (
                  <RaceCard key={r.id} race={r} />
                ))}
              </div>
            )}
          </section>

          {scored.length > 0 && (
            <section className="races-section">
              <div className="races-section-head">
                <h2>Scored</h2>
                <span className="races-count">{scored.length}</span>
              </div>
              <div className="race-grid">
                {scored.map((r) => (
                  <RaceCard key={r.id} race={r} />
                ))}
              </div>
            </section>
          )}

          <section className="races-section">
            <div className="races-section-head">
              <h2>All races</h2>
              <span className="races-count">{races.length}</span>
            </div>
            <div className="table-scroll">
              <table className="table races-index">
                <thead>
                  <tr>
                    <th>Race</th>
                    <th>Track</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {races.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Race">
                        <Link to={`/races/${r.id}`}>{r.name}</Link>
                      </td>
                      <td data-label="Track">{r.track || '—'}</td>
                      <td data-label="Date">{formatDate(r.eventDate) || '—'}</td>
                      <td data-label="Status">
                        <span
                          className={`badge ${
                            isScored(r) ? 'badge-finished' : 'badge-scheduled'
                          }`}
                        >
                          {isScored(r) ? 'Results in' : 'Open'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
