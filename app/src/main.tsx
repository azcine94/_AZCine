import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import {NotesWindow} from './notes-window.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('AZCine root element is missing.');
const noteWindow=(window as unknown as {__AZCINE_NOTE_WINDOW__?:{root:string;path:string}}).__AZCINE_NOTE_WINDOW__;
createRoot(root).render(<StrictMode>{noteWindow?<NotesWindow {...noteWindow}/>:<App />}</StrictMode>);
