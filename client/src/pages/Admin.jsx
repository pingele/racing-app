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

  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerBanner, setDangerBanner] = useState(null); // { type, text }

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

  const importEntries = async (race) => {
    setRowBusy((b) => ({ ...b, [race.id]: 'entries' }));
    setBanner(null);
    try {
      const res = await api.importRaceEntries(race.mrpEventId);
      const entryCount = res?.entryCount ?? 0;
      const classCount = res?.classCount ?? 0;
      let banner;
      if (entryCount === 0) {
        banner = {
          type: 'info',
          text: `Nothing posted on MyRacePass yet for "${race.name}" — no lineups and no entry list. Try again once entries or race-day lineups are posted.`,
        };
      } else if (res?.source === 'entries') {
        banner = {
          type: 'info',
          text: `Lineups aren't drawn yet for "${race.name}", so the entry list was imported (view-only) — ${classCount} ${
            classCount === 1 ? 'class' : 'classes'
          }, ${entryCount} entries. Players can see the field but can't predict yet; re-import once Features/Heats post to open per-session predictions.`,
        };
      } else {
        banner = {
          type: 'success',
          text: `Lineups imported for "${race.name}" — ${classCount} sessions (Features + Heats), ${entryCount} entries.${
            res?.reaped ? ` Replaced ${res.reaped} provisional entry-list ${res.reaped === 1 ? 'class' : 'classes'}.` : ''
          }`,
        };
      }
      setBanner(banner);
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

  const resetResults = async (race) => {
    if (
      !window.confirm(
        `Reset results for "${race.name}"? This removes the entered finishing order and clears everyone's scores for this race. Players' predictions are kept, so you can re-enter results and re-score.`,
      )
    )
      return;
    setRowBusy((b) => ({ ...b, [race.id]: 'reset' }));
    setBanner(null);
    try {
      const res = await api.resetRaceResults(race.id);
      setBanner({
        type: 'success',
        text: `Reset "${race.name}" — removed ${res?.resultsDeleted ?? 0} result rows and cleared ${res?.scoresCleared ?? 0} scores. Predictions kept.`,
      });
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Reset failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  const clearRacePredictions = async (race) => {
    if (
      !window.confirm(
        `Delete ALL predictions and scores for "${race.name}"? This can't be undone.`,
      )
    )
      return;
    setRowBusy((b) => ({ ...b, [race.id]: 'clear' }));
    setBanner(null);
    try {
      const res = await api.clearPredictions(race.id);
      setBanner({
        type: 'success',
        text: `Cleared ${res?.deleted ?? 0} predictions for "${race.name}".`,
      });
      await refresh();
    } catch (err) {
      setBanner({ type: 'error', text: `Clear failed: ${err.message}` });
    } finally {
      setRowBusy((b) => ({ ...b, [race.id]: undefined }));
    }
  };

  const clearAllPredictions = async () => {
    if (
      !window.confirm(
        'Delete ALL predictions and scores for EVERY race? This resets the whole game and cannot be undone. Users and logins are kept.',
      )
    )
      return;
    setDangerBusy(true);
    setDangerBanner(null);
    try {
      const res = await api.clearPredictions();
      setDangerBanner({
        type: 'success',
        text: `Cleared ${res?.deleted ?? 0} predictions across all races. Standings are now empty.`,
      });
      await refresh();
    } catch (err) {
      setDangerBanner({ type: 'error', text: `Clear failed: ${err.message}` });
    } finally {
      setDangerBusy(false);
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
                  <td data-label="Event">
                    <Link to={`/races/${r.id}`}>{r.name}</Link>
                    {r.hidden && <span className="badge badge-hidden">Hidden</span>}
                  </td>
                  <td data-label="Track">{r.track || ''}</td>
                  <td data-label="Date">{formatDate(r.eventDate)}</td>
                  <td data-label="ID">{r.mrpEventId}</td>
                  <td data-label="Status">{r.status === 'completed' ? 'Results in' : 'Open'}</td>
                  <td data-label="Predictions">{r.predictionsLocked ? '🔒 Locked' : 'Open'}</td>
                  <td data-label="Actions" className="actions-cell">
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
                        className="btn btn-primary"
                        onClick={() => importEntries(r)}
                        disabled={!!busy}
                        title="Import Feature & Heat lineups from MyRacePass"
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
                      {r.resultsScrapedAt && (
                        <button
                          className="btn btn-danger"
                          onClick={() => resetResults(r)}
                          disabled={!!busy}
                          title="Remove entered results and clear scores (keeps predictions)"
                        >
                          {busy === 'reset' ? 'Resetting…' : 'Reset results'}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => clearRacePredictions(r)}
                        disabled={!!busy}
                        title="Delete all predictions and scores for this race"
                      >
                        {busy === 'clear' ? 'Clearing…' : 'Clear predictions'}
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
                  <td data-label="Name">
                    {u.displayName || '—'}
                    {isSelf && (
                      <span className="badge badge-scheduled" style={{ marginLeft: '0.5rem' }}>
                        You
                      </span>
                    )}
                  </td>
                  <td data-label="Email">{u.email || '—'}</td>
                  <td data-label="Role">{isAdmin ? '🛡️ Admin' : 'User'}</td>
                  <td data-label="Actions" className="actions-cell">
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

      <h2>Danger zone</h2>
      <div className="card danger-card">
        <p className="muted">
          Clear every prediction and score across all races — use when starting a
          fresh season with a new group of players. Races, results, and user
          logins are kept; standings reset to empty.
        </p>
        {dangerBanner && <p className={dangerBanner.type}>{dangerBanner.text}</p>}
        <button
          className="btn btn-danger"
          onClick={clearAllPredictions}
          disabled={dangerBusy}
        >
          {dangerBusy ? 'Clearing…' : 'Clear all predictions & scores'}
        </button>
      </div>
    </section>
  );
}
