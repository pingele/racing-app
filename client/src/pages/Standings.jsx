import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Standings() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api
      .standings()
      .then((r) => setRows(r.standings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading standings...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1>Standings</h1>
      <p className="muted">
        Running totals across all events. Click a racer to see their per-event scores.
      </p>
      {rows.length === 0 ? (
        <div className="card info">
          <p className="muted">No predictions scored yet.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Racer</th>
              <th>Predictions</th>
              <th>Scored</th>
              <th>Total points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.userId}>
                <tr
                  className={row.userId === user?.id ? 'me-row' : ''}
                  onClick={() =>
                    setExpanded(expanded === row.userId ? null : row.userId)
                  }
                  style={{ cursor: 'pointer' }}
                >
                  <td>{row.rank}</td>
                  <td>{row.displayName}</td>
                  <td>{row.predictionsMade}</td>
                  <td>{row.predictionsScored}</td>
                  <td>{row.totalPoints}</td>
                </tr>
                {expanded === row.userId && (
                  <tr>
                    <td colSpan={5}>
                      {row.events.length === 0 ? (
                        <span className="muted">No scored events yet.</span>
                      ) : (
                        <ul className="results-list">
                          {row.events.map((ev) => (
                            <li key={ev.raceId}>
                              <span className="pos">{ev.points}</span>
                              <span>{ev.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
