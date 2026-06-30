import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function NavBar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <img src="/vermeer-logo.svg" alt="Vermeer" className="brand-logo" />
        <span className="brand-text">Fantasy Racing</span>
      </Link>
      <nav className="nav-links">
        {user ? (
          <>
            <NavLink to="/races">Races</NavLink>
            <NavLink to="/standings">Standings</NavLink>
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            <span className="nav-user">{user.displayName}</span>
            <button className="btn btn-ghost" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <NavLink to="/register">Sign up</NavLink>
          </>
        )}
      </nav>
    </header>
  );
}
