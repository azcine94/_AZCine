// Targeted browser harness: production hook and chat, explicit IPC replay only.
import { createRoot } from 'react-dom/client';
import { usePi } from '../../src/use-pi.ts';
import { AgentChat } from '../../src/pi-agent-panel.tsx';
import '../../src/styles/globals.css';

function Harness() {
  const model = usePi('X:/ExplicitTitleRefresh');
  (window as any).titleModel = model;
  return <div style={{height:'100dvh',padding:16}}><AgentChat model={model}/></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
