import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import NavBar from './components/NavBar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Races from './pages/Races.jsx';
import RaceDetail from './pages/RaceDetail.jsx';
import Calendar from './pages/Calendar.jsx';
import Knoxville from './pages/Knoxville.jsx';
import MyPicks from './pages/MyPicks.jsx';
import Leaderboard from './pages/Leaderboard.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { loading } = useAuth();
  return (
    <>
      <NavBar />
      <main className="container">
        {loading ? (
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
              path="/calendar"
              element={
                <ProtectedRoute>
                  <Calendar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/knoxville"
              element={
                <ProtectedRoute>
                  <Knoxville />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-picks"
              element={
                <ProtectedRoute>
                  <MyPicks />
                </ProtectedRoute>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <ProtectedRoute>
                  <Leaderboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/races" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}
