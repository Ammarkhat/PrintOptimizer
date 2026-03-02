import { useNavigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import './DashboardPage.css';

const tools = [
  {
    id: 'support-optimizer',
    title: 'Support Reduction Optimizer',
    description:
      'Upload an STL file and automatically minimize support structures to reduce material usage and print time.',
    icon: '🏗️',
    path: '/support-optimizer',
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-row">
          <h2>Optimization Tools</h2>
          <p className="dashboard-greeting">
            {user?.email ? `Signed in as ${user.email}` : ''}
          </p>
        </div>
        <p>Select a tool to get started with your 3D print optimization.</p>
      </header>

      <div className="tools-grid">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="tool-card"
            onClick={() => navigate(tool.path)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate(tool.path)}
          >
            <span className="tool-icon">{tool.icon}</span>
            <h3 className="tool-title">{tool.title}</h3>
            <p className="tool-desc">{tool.description}</p>
            <span className="tool-cta">Open Tool →</span>
          </div>
        ))}
      </div>
    </main>
  );
};

export default DashboardPage;
