import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

// Match the Knoxville, IA dirt oval. Require both "Knoxville" and "Raceway"
// as whole words (in that order) so variants like "Knoxville Raceway",
// "Knoxville (IA) Raceway", or "Knoxville, IA - Raceway" all match, while
// "Knoxville Speedway" and other unrelated venues are excluded.
const TRACK_MATCH = /\bknoxville\b[^\n]*?\braceway\b/i;

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function Knoxville() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getCalendar()
      .then((data) => setRaces(data.races || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const upcoming = useMemo(() => {
    const cutoff = startOfToday();
    // Months are 0-indexed: 5 = June, 6 = July, 7 = August.
    const SUMMER_MONTHS = new Set([5, 6, 7]);
    const TARGET_YEAR = 2026;
    return races
      .filter((r) => TRACK_MATCH.test(r.track || ''))
      .filter((r) => {
        if (!r.start_time) return false;
        const t = Date.parse(r.start_time);
        if (Number.isNaN(t)) return false;
        if (t < cutoff) return false;
        const d = new Date(t);
        return d.getFullYear() === TARGET_YEAR && SUMMER_MONTHS.has(d.getMonth());
      })
      .sort((a, b) => {
        const at = a.start_time ? Date.parse(a.start_time) : Number.POSITIVE_INFINITY;
        const bt = b.start_time ? Date.parse(b.start_time) : Number.POSITIVE_INFINITY;
        return at - bt;
      });
  }, [races]);

  if (loading) return <p>Loading Knoxville races...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <header className="page-head">
        <h1>Knoxville Raceway</h1>
        <p className="muted">Upcoming June, July, and August 2026 races at Knoxville (IA).</p>
      </header>
      {upcoming.length === 0 ? (
        <p className="muted">No upcoming Knoxville races on the schedule.</p>
      ) : (
        <div className="race-grid">
          {upcoming.map((race) => (
            <KnoxvilleRaceCard key={race.external_id || race.id} race={race} />
          ))}
        </div>
      )}
    </section>
  );
}

function KnoxvilleRaceCard({ race }) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const when = race.start_time ? DATE_FMT.format(new Date(race.start_time)) : 'TBD';

  const inner = (
    <>
      <div className="race-card-head">
        <h3>{race.name}</h3>
        <StatusBadge status={race.status} />
      </div>
      <div className="race-meta">
        <span>{race.series || 'Series TBD'}</span>
        <span>{race.track || 'Track TBD'}</span>
      </div>
      <div className="race-time">{when}</div>
      {error && <div className="error">{error}</div>}
    </>
  );

  if (race.id) {
    return (
      <Link to={`/races/${race.id}`} className="card race-card">
        {inner}
      </Link>
    );
  }

  const handleClick = async () => {
    if (syncing || !race.external_id) return;
    setSyncing(true);
    setError(null);
    try {
      const data = await api.syncRaceByExternalId(race.external_id);
      const id = data?.race?.id;
      if (!id) throw new Error('Race could not be imported');
      navigate(`/races/${id}`);
    } catch (err) {
      setError(err.message || 'Sync failed');
      setSyncing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={syncing}
      className="card race-card race-card-button"
    >
      {inner}
      {syncing && <div className="muted">Importing…</div>}
    </button>
  );
}
