import { NavLink, useNavigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import { logout } from '../firebase/authService';
import './Navbar.css';

const Navbar = () => {
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <span className="navbar-brand" onClick={() => navigate('/')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/')}
        >
          🖨️ PrintOptimizer
        </span>

        <div className="navbar-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `navbar-link${isActive ? ' is-active' : ''}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/support-optimizer"
            className={({ isActive }) =>
              `navbar-link${isActive ? ' is-active' : ''}`
            }
          >
            Support Optimizer
          </NavLink>
        </div>
      </div>
      <div className="navbar-actions">
        {user && (
          <>
            <span className="navbar-email">{user.email}</span>
            <button className="btn btn-outline" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
