import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge.jsx';

function formatTime(iso) {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString();
}

export default function RaceCard({ race }) {
  return (
    <Link to={`/races/${race.id}`} className="card race-card">
      <div className="race-card-head">
        <h3>{race.name}</h3>
        <StatusBadge status={race.status} />
      </div>
      <div className="race-meta">
        <span>{race.series || 'Series TBD'}</span>
        <span>{race.track || 'Track TBD'}</span>
      </div>
      <div className="race-time">{formatTime(race.start_time)}</div>
    </Link>
  );
}
