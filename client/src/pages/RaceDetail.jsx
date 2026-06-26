import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

function isLocked(race) {
  // Picks stay open through scheduled + live races; lock only after the
  // race is finished.
  return race.status === 'finished';
}

export default function RaceDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionResults, setSessionResults] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const load = async () => {
    const [detail, myPick] = await Promise.all([api.getRace(id), api.getMyPick(id)]);
    setData(detail);
    setPick(myPick.pick);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
    api
      .listSessions(id)
      .then((r) => setSessions(r.sessions || []))
      .catch(() => setSessions([]));
  }, [id]);

  useEffect(() => {
    if (!activeSessionId) {
      setSessionResults(null);
      return;
    }
    setSessionLoading(true);
    api
      .getSessionResults(id, activeSessionId)
      .then((r) => setSessionResults(r.results || []))
      .catch((err) => setError(err.message))
      .finally(() => setSessionLoading(false));
  }, [id, activeSessionId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading race...</p>;

  const { race, drivers, results } = data;
  const locked = isLocked(race);

  // When the user picks an alternate session, show its live results;
  // otherwise fall back to the DB-synced default session (`results`).
  const displayedResults = activeSessionId
    ? (sessionResults ?? []).map((r) => ({
        driver_id: r.driver_external_id,
        name: r.name,
        number: r.number,
        finish_position: r.finish_position,
        status: r.status,
        laps: r.laps,
        total_time: r.total_time,
        best_lap_time: r.best_lap_time,
        last_lap_time: r.last_lap_time,
      }))
    : results;

  const driverName = (driverId) => {
    const d = drivers.find((x) => x.id === driverId);
    return d ? d.name : `Driver #${driverId}`;
  };

  const submitPick = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await api.createPick(race.id, Number(selected));
      await load();
      setMessage('Your pick is locked in. Good luck!');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="detail-head">
        <h1>{race.name}</h1>
        <StatusBadge status={race.status} />
      </div>
      <p className="muted">
        {race.series} · {race.track} ·{' '}
        {race.start_time ? new Date(race.start_time).toLocaleString() : 'TBD'}
      </p>

      {pick && (
        <div className="card info">
          Your pick: <strong>{driverName(pick.driver_id)}</strong>
          {pick.points_awarded != null && (
            <span> · Scored {pick.points_awarded} pts</span>
          )}
        </div>
      )}

      {race.status === 'finished' ? (
        <div className="card">
          <div className="results-head">
            <h2>Results</h2>
            {sessions.length > 1 && (
              <label className="session-picker">
                <span className="muted">Class / session</span>
                <select
                  value={activeSessionId}
                  onChange={(e) => setActiveSessionId(e.target.value)}
                >
                  <option value="">Default (latest)</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.category || s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {sessionLoading ? (
            <p className="muted">Loading session results...</p>
          ) : displayedResults.length === 0 ? (
            <p className="muted">Final results aren't available yet.</p>
          ) : (
            <table className="results-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Laps</th>
                  <th>Total time</th>
                  <th>Best lap</th>
                  <th>Last lap</th>
                </tr>
              </thead>
              <tbody>
                {displayedResults.map((r) => (
                  <tr key={r.driver_id}>
                    <td>{r.finish_position > 0 ? `P${r.finish_position}` : (r.status || '—')}</td>
                    <td>{r.number || ''}</td>
                    <td>{r.name}</td>
                    <td>{r.laps ?? ''}</td>
                    <td>{r.total_time || ''}</td>
                    <td>{r.best_lap_time || ''}</td>
                    <td>{r.last_lap_time || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          <h2>Choose your winner</h2>
          {locked ? (
            <p className="muted">Picks are locked — this race has finished.</p>
          ) : pick ? (
            <p className="muted">You have already made your pick for this race.</p>
          ) : drivers.length === 0 ? (
            <p className="muted">
              The driver lineup isn't available yet. Check back closer to race time
              once the timing system is online.
            </p>
          ) : (
            <form onSubmit={submitPick} className="pick-form">
              <div className="driver-list">
                {drivers.map((d) => (
                  <label key={d.id} className="driver-option">
                    <input
                      type="radio"
                      name="driver"
                      value={d.id}
                      checked={String(selected) === String(d.id)}
                      onChange={(e) => setSelected(e.target.value)}
                    />
                    <span className="driver-num">#{d.number}</span>
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
              {error && <p className="error">{error}</p>}
              {message && <p className="success">{message}</p>}
              <button className="btn btn-primary" disabled={!selected || busy}>
                {busy ? 'Submitting...' : 'Lock in pick'}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
