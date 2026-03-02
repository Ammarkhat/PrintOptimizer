import { Navigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';

/**
 * Wraps a route so only authenticated users can access it.
 * While auth state is being resolved (user === undefined) we render nothing.
 */
const PrivateRoute = ({ children }) => {
  const user = useAppStore((s) => s.user);

  // user is undefined → auth state still resolving
  // user is null      → not authenticated
  // user is object    → authenticated
  if (user === undefined) {
    return null;
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default PrivateRoute;
