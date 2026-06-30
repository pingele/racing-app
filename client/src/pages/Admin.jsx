import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Admin() {
  const [eventId, setEventId] = useState('');
  const [importing, setImporting] = useState(false);
  const [banner, setBanner] = useState(null); // { type, text }
  const [races, setRaces] = useState([]);
  const [rowBusy, setRowBusy] = useState({}); // raceId -> action label

  const refresh = () => api.listRaces().then(setRaces).catch(() => {});

  useEffect(() => {
    refresh();
  }, []);

  const importDetails = async (e) => {
    e.preventDefault();
    const id = eventId.trim();
    if (!id) return;
    setImporting(true);
    setBanner(null);
    try {
      const res = await api.importRaceDetails(id);
      setBanner({
        type: 'success',
        text: `Imported "${res?.name ?? id}" — ${res?.classCount ?? 0} classes, ${
          res?.entryCount ?? 0
        } entries.`,
      });
      setEventId('');
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Import failed: ${err.message}` });
    } finally {
      setImporting(false);
    }
  };

  const importResults = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'results' }));
    setBanner(null);
    try {
      const res = await api.importRaceResults(race.mrpEventId);
      setBanner({
        type: 'success',
        text: `Results imported for "${race.name}" — ${res?.resultClasses ?? 0} classes, ${
          res?.scoredPredictions ?? 0
        } predictions scored.`,
      });
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Results import failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  const toggleLock = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'lock' }));
    try {
      await api.setLock(race.id, !race.predictionsLocked);
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Lock failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  return (
    <section>
      <h1>Admin</h1>
      <p className="muted">
        Pull a MyRacePass event in by its numeric event ID (the number in a
        myracepass.com/events/<strong>ID</strong> URL).
      </p>

      <div className="card">
        <form onSubmit={importDetails}>
          <label>
            MyRacePass event ID
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 614370"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={importing || !eventId.trim()}>
            {importing ? 'Importing…' : 'Import race details'}
          </button>
        </form>
        {banner && <p className={banner.type}>{banner.text}</p>}
      </div>

      <h2>Imported races</h2>
      {races.length === 0 ? (
        <p className="muted">Nothing imported yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Track</th>
              <th>Date</th>
              <th>ID</th>
              <th>Status</th>
              <th>Predictions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => {
              const busy = rowBusy[r.id];
              return (
                <tr key={r.id}>
                  <td>
                    <Link to={`/races/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.track || ''}</td>
                  <td>{formatDate(r.eventDate)}</td>
                  <td>{r.mrpEventId}</td>
                  <td>{r.status === 'completed' ? 'Results in' : 'Open'}</td>
                  <td>{r.predictionsLocked ? '🔒 Locked' : 'Open'}</td>
                  <td>
                    <div className="admin-actions">
                      <button
                        className="btn btn-ghost btn-dark"
                        onClick={() => toggleLock(r)}
                        disabled={!!busy}
                      >
                        {busy === 'lock'
                          ? '…'
                          : r.predictionsLocked
                          ? 'Unlock'
                          : 'Lock'}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => importResults(r)}
                        disabled={!!busy}
                      >
                        {busy === 'results' ? 'Importing…' : 'Import results'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
