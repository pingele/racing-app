import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function Scoring() {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .scoringRules()
      .then(setRules)
      .catch((err) => setError(err.message));
  }, []);

  const topRule = rules?.[0];

  return (
    <section>
      <h1>How scoring works</h1>
      <p className="muted">
        Predict the finishing order for each class, then earn points for the
        drivers you place in exactly the right spot.
      </p>

      <div className="card">
        <h2>The idea</h2>
        <p>
          Before an event is locked, you drag the drivers in each class into the
          order you think they&apos;ll finish — your #1 is your predicted winner.
          Once the results are in, we compare your order to the actual finish.
        </p>
        <p>
          Scoring is <strong>F1-style</strong> and position-exact: you earn the
          points for a spot only when the driver you placed there actually
          finished there. Put the winner in P1 and you bank the top score for
          that class; nail P2 as well and you add the P2 points on top. Being
          one spot off doesn&apos;t score — the match has to be exact.
        </p>
      </div>

      <div className="card">
        <h2>Points per position</h2>
        {error ? (
          <p className="error">{error}</p>
        ) : !rules ? (
          <p>Loading points table...</p>
        ) : (
          <>
            <table className="results-table">
              <thead>
                <tr>
                  <th>Finish position</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.finishPosition}>
                    <td>P{r.finishPosition}</td>
                    <td>{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              Positions outside this table score nothing, so a correct pick for
              P{topRule ? rules[rules.length - 1].finishPosition : 10} still
              counts but there are no points below it.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Your total</h2>
        <ul>
          <li>
            Your score for a race is the sum of the points you earn across every
            class in that event.
          </li>
          <li>
            The <Link to="/standings">Standings</Link> add up your points across
            all events for the season-long leaderboard.
          </li>
          <li>
            After results are imported, each class on the race page shows your
            picks next to the finish and highlights the ones that scored.
          </li>
        </ul>
      </div>
    </section>
  );
}
