import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAuthListener from './hooks/useAuthListener';
import PrivateRoute from './components/PrivateRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SupportReductionPage from './pages/SupportReductionPage';

function App() {
  useAuthListener();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/support-reduction"
          element={
            <PrivateRoute>
              <SupportReductionPage />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
