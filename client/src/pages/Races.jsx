import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import RaceCard from '../components/RaceCard.jsx';

export default function Races() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listRaces()
      .then((data) => setRaces(data.races))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading races...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1>Races</h1>
      <p className="muted">Pick a race, then choose who you think will win.</p>
      <div className="race-grid">
        {races.map((race) => (
          <RaceCard key={race.id} race={race} />
        ))}
      </div>
    </section>
  );
}
