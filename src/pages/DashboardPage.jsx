import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import './DashboardPage.css';

const tools = [
  {
    id: 'support-reduction',
    title: 'Support Reduction Optimizer',
    description:
      'Upload an STL file and automatically minimize support structures to reduce material usage and print time.',
    icon: '🏗️',
    path: '/support-reduction',
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();

  return (
    <>
      <Navbar />
      <main className="dashboard">
        <header className="dashboard-header">
          <h2>Optimization Tools</h2>
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
    </>
  );
};

export default DashboardPage;
