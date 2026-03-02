import { useNavigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import { logoutUser } from '../firebase/authService';
import './Navbar.css';

const Navbar = () => {
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <span className="navbar-brand" onClick={() => navigate('/')}>
        🖨️ PrintOptimizer
      </span>
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
