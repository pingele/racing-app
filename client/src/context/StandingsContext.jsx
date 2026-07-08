import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const StandingsContext = createContext(null);

const TOP_N = 5;

// Holds the live top-N standings for the leaderboard rail. Subscribes to the
// Prediction model while a user is signed in, so the leaderboard refreshes the
// moment a race is scored, and tears the subscription down on logout.
export function StandingsProvider({ children }) {
  const { user } = useAuth();
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) {
      setTop([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setError(null);
    const unsubscribe = api.subscribeStandings(
      (rows) => {
        setTop(rows.slice(0, TOP_N));
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Could not load standings');
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [user?.id]);

  return (
    <StandingsContext.Provider value={{ top, loading, error }}>
      {children}
    </StandingsContext.Provider>
  );
}

export function useStandings() {
  const ctx = useContext(StandingsContext);
  if (!ctx) throw new Error('useStandings must be used within StandingsProvider');
  return ctx;
}
