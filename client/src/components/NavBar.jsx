import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function NavBar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = async () => {
    closeMenu();
    await logout();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <Link to="/" className="brand" onClick={closeMenu}>
        <img src="/vermeer-logo.svg" alt="Vermeer" className="brand-logo" />
        <span className="brand-text">Fantasy Racing</span>
      </Link>
      <button
        type="button"
        className="nav-toggle"
        aria-label="Toggle navigation menu"
        aria-expanded={menuOpen}
        aria-controls="primary-nav"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
        <span className="nav-toggle-bar" />
      </button>
      <nav
        id="primary-nav"
        className={`nav-links${menuOpen ? ' nav-links-open' : ''}`}
      >
        {user ? (
          <>
            <NavLink to="/races" onClick={closeMenu}>
              Races
            </NavLink>
            <NavLink to="/standings" onClick={closeMenu}>
              Standings
            </NavLink>
            <NavLink to="/scoring" onClick={closeMenu}>
              Scoring
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" onClick={closeMenu}>
                Admin
              </NavLink>
            )}
            <span className="nav-user">{user.displayName}</span>
            <button className="btn btn-ghost" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login" onClick={closeMenu}>
              Log in
            </NavLink>
            <NavLink to="/register" onClick={closeMenu}>
              Sign up
            </NavLink>
          </>
        )}
      </nav>
    </header>
  );
}
