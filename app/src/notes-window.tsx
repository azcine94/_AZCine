import {NotesPanel} from './notes-panel.tsx';
import {OperationToast} from './components/ui/operation-toast.tsx';
import {useTheme} from './use-theme.ts';
export function NotesWindow({root,path}:{root:string;path:string}){
  useTheme();
  return <div className="notes-window"><NotesPanel root={root} active initialPath={path}/><OperationToast/></div>;
}
