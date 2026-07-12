import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import NavBar from './components/NavBar.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Races from './pages/Races.jsx';
import RaceDetail from './pages/RaceDetail.jsx';
import Standings from './pages/Standings.jsx';
import Scoring from './pages/Scoring.jsx';
import Admin from './pages/Admin.jsx';
import EnterResults from './pages/EnterResults.jsx';
import BuildLineups from './pages/BuildLineups.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div className="container">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/races" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  const content = loading ? (
    <div>Loading...</div>
  ) : (
    <Routes>
      <Route path="/" element={<Navigate to="/races" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/races"
        element={
          <ProtectedRoute>
            <Races />
          </ProtectedRoute>
        }
      />
      <Route
        path="/races/:id"
        element={
          <ProtectedRoute>
            <RaceDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/standings"
        element={
          <ProtectedRoute>
            <Standings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scoring"
        element={
          <ProtectedRoute>
            <Scoring />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <Admin />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/races/:raceId/results"
        element={
          <AdminRoute>
            <EnterResults />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/races/:raceId/lineups"
        element={
          <AdminRoute>
            <BuildLineups />
          </AdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/races" replace />} />
    </Routes>
  );

  return (
    <>
      <UpdatePrompt />
      <NavBar />
      {user ? (
        <div className="app-shell">
          <Leaderboard />
          <main className="container app-main">{content}</main>
        </div>
      ) : (
        <main className="container">{content}</main>
      )}
    </>
  );
}
