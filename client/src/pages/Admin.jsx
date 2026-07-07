import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// A busy/slow MyRacePass page or a Lambda timeout surfaces as a 5xx / timeout
// error. These are transient — re-running the import usually succeeds.
function isTransientError(err) {
  const m = (err?.message || '').toLowerCase();
  return /\b5\d\d\b/.test(m) || m.includes('timeout') || m.includes('timed out');
}

export default function Admin() {
  const { user } = useAuth();
  const [eventId, setEventId] = useState('');
  const [importing, setImporting] = useState(false);
  const [banner, setBanner] = useState(null); // { type, text }
  const [races, setRaces] = useState([]);
  const [rowBusy, setRowBusy] = useState({}); // raceId -> action label

  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [userBusy, setUserBusy] = useState({}); // userId -> boolean
  const [userBanner, setUserBanner] = useState(null); // { type, text }

  const refresh = () =>
    api.listRaces({ includeHidden: true }).then(setRaces).catch(() => {});

  const refreshUsers = () =>
    api.listUserProfiles().then(setUsers).catch(() => {});

  useEffect(() => {
    refresh();
    refreshUsers();
  }, []);

  // Filter by display name or email. Empty query lists everyone.
  const matchedUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q),
    );
  }, [users, userQuery]);

  const setAdminRole = async (u, makeAdmin) => {
    setUserBusy((b) => ({ ...b, [u.userId]: true }));
    setUserBanner(null);
    try {
      await api.setAdminRole(u.userId, makeAdmin);
      const name = u.displayName || u.email || 'User';
      setUserBanner({
        type: 'success',
        text: makeAdmin
          ? `${name} is now an admin. They'll get admin access the next time their session refreshes.`
          : `Removed admin access from ${name}.`,
      });
      await refreshUsers();
    } catch (err) {
      setUserBanner({ type: 'error', text: `Role change failed: ${err.message}` });
    } finally {
      setUserBusy((b) => ({ ...b, [u.userId]: undefined }));
    }
  };

  const importDetails = async (e) => {
    e.preventDefault();
    const id = eventId.trim();
    if (!id) return;
    setImporting(true);
    setBanner(null);
    try {
      await api.importRaceDetails(id);
      setBanner({
        type: 'success',
        text: 'Import successful, check race details for entries',
      });
      setEventId('');
      await refresh();
    } catch (err) {
      setBanner(
        isTransientError(err)
          ? { type: 'error', text: 'Import failed (server busy) - re-run' }
          : { type: 'error', text: `Import failed: ${err.message}` },
      );
    } finally {
      setImporting(false);
    }
  };

  const importClasses = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'classes' }));
    setBanner(null);
    try {
      const res = await api.importRaceClasses(race.mrpEventId);
      const classCount = res?.classCount ?? 0;
      const created = res?.created ?? 0;
      setBanner(
        classCount === 0
          ? {
              type: 'info',
              text: `No classes posted on MyRacePass yet for "${race.name}".`,
            }
          : {
              type: 'success',
              text: `${classCount} classes on MyRacePass for "${race.name}"${
                created ? ` — ${created} added` : ' — all already imported'
              }. Import entries once they're posted.`,
            },
      );
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Classes import failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  const importEntries = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'entries' }));
    setBanner(null);
    try {
      const res = await api.importRaceEntries(race.mrpEventId);
      const entryCount = res?.entryCount ?? 0;
      setBanner(
        entryCount === 0
          ? {
              type: 'info',
              text: `No entry list published on MyRacePass yet for "${race.name}". Entries are usually released on race day — try again once they're posted.`,
            }
          : {
              type: 'success',
              text: `Entries imported for "${race.name}" — ${
                res?.classCount ?? 0
              } classes, ${entryCount} entries.`,
            },
      );
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Entries import failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  const importResults = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'results' }));
    setBanner(null);
    try {
      const res = await api.importRaceResults(race.mrpEventId);
      const resultClasses = res?.resultClasses ?? 0;
      setBanner(
        resultClasses === 0
          ? {
              type: 'info',
              text: `No results posted on MyRacePass yet for "${race.name}". Try again after the event has run.`,
            }
          : {
              type: 'success',
              text: `Results imported for "${race.name}" — ${resultClasses} classes, ${
                res?.scoredPredictions ?? 0
              } predictions scored.`,
            },
      );
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

  const toggleHidden = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'hide' }));
    try {
      await api.setHidden(race.id, !race.hidden);
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Hide failed: ${err.message}` });
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
                <tr key={r.id} className={r.hidden ? 'hidden-row' : undefined}>
                  <td>
                    <Link to={`/races/${r.id}`}>{r.name}</Link>
                    {r.hidden && <span className="badge badge-hidden">Hidden</span>}
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
                        onClick={() => toggleHidden(r)}
                        disabled={!!busy}
                      >
                        {busy === 'hide' ? '…' : r.hidden ? 'Show' : 'Hide'}
                      </button>
                      <button
                        className="btn btn-ghost btn-dark"
                        onClick={() => toggleLock(r)}
                        disabled={!!busy}
                      >
                        {busy === 'lock'
                          ? '…'
                          : r.predictionsLocked
                          ? 'Unlock all'
                          : 'Lock all'}
                      </button>
                      <button
                        className="btn btn-ghost btn-dark"
                        onClick={() => importClasses(r)}
                        disabled={!!busy}
                      >
                        {busy === 'classes' ? '…' : 'Import classes'}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => importEntries(r)}
                        disabled={!!busy}
                      >
                        {busy === 'entries' ? 'Importing…' : 'Import entries'}
                      </button>
                      <Link
                        to={`/admin/races/${r.id}/results`}
                        className="btn btn-primary"
                      >
                        Lock & score
                      </Link>
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

      <h2>User roles</h2>
      <p className="muted">
        Search by name and grant or revoke admin access. Only people who have
        logged in at least once appear here.
      </p>

      <div className="card">
        <label>
          Search users
          <input
            type="text"
            placeholder="Start typing a name…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />
        </label>
        {userBanner && <p className={userBanner.type}>{userBanner.text}</p>}
      </div>

      {matchedUsers.length === 0 ? (
        <p className="muted">
          {users.length === 0 ? 'No users yet.' : 'No users match that search.'}
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {matchedUsers.map((u) => {
              const isAdmin = u.role === 'admin';
              const isSelf = u.userId === user?.id;
              const busy = !!userBusy[u.userId];
              return (
                <tr key={u.userId} className={isSelf ? 'me-row' : undefined}>
                  <td>
                    {u.displayName || '—'}
                    {isSelf && (
                      <span className="badge badge-scheduled" style={{ marginLeft: '0.5rem' }}>
                        You
                      </span>
                    )}
                  </td>
                  <td>{u.email || '—'}</td>
                  <td>{isAdmin ? '🛡️ Admin' : 'User'}</td>
                  <td>
                    <div className="admin-actions">
                      {isAdmin ? (
                        <button
                          className="btn btn-ghost btn-dark"
                          onClick={() => setAdminRole(u, false)}
                          disabled={busy || isSelf}
                          title={isSelf ? "You can't remove your own admin access" : undefined}
                        >
                          {busy ? '…' : 'Remove admin'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          onClick={() => setAdminRole(u, true)}
                          disabled={busy}
                        >
                          {busy ? '…' : 'Make admin'}
                        </button>
                      )}
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
