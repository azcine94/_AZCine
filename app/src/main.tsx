import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/workspace.css';
import './styles/projects.css';
import './styles/pi.css';
import './styles/ideas.css';

const root = document.getElementById('root');
if (!root) throw new Error('AZCine root element is missing.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
