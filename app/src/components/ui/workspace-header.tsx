import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent, ReactNode, Dispatch, SetStateAction } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react';
import { isTauri } from '../../desktop-api.ts';
import { Button } from './button.tsx';
import { notifyOperation, OperationToast } from './operation-toast.tsx';

const HeaderSlot = createContext<{target:HTMLDivElement|null;setTarget:Dispatch<SetStateAction<HTMLDivElement|null>>}|null>(null);

export function WorkspaceHeaderProvider({children}:{children:ReactNode}){
  const [target,setTarget]=useState<HTMLDivElement|null>(null);
  return <HeaderSlot.Provider value={{target,setTarget}}>{children}</HeaderSlot.Provider>;
}

function dragWindow(event:MouseEvent<HTMLElement>){
  if(!isTauri()||event.button!==0||!(event.target instanceof Element)||!event.currentTarget.contains(event.target))return;
  if(event.target.closest('button,a,input,select,textarea,summary,[role="button"],[role="tab"],[contenteditable="true"],[data-no-window-drag]'))return;
  event.preventDefault();
  const appWindow=getCurrentWindow();
  void (event.detail===2?appWindow.toggleMaximize():appWindow.startDragging()).catch(()=>notifyOperation('窗口操作未完成，请重试。',{tone:'error'}));
}

/** Full-page headers share the titlebar; embedded panels retain their local header. */
export function WorkspacePageHeader({children,active=true,scope}:{children:ReactNode;active?:boolean;scope?:string}){
  const slot=useContext(HeaderSlot);
  useLayoutEffect(()=>{
    if(!active)return;
    const heading=slot?.target?.querySelector<HTMLElement>('.workspace-header-custom h1,.workspace-header-custom h2');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  },[slot?.target,active]);
  if(!active||!slot)return <>{children}</>;
  return slot.target?createPortal(<div className="workspace-header-custom" onMouseDown={dragWindow}>{scope?<div className={scope} data-redesign="true">{children}</div>:children}</div>,slot.target):null;
}

interface WorkspaceHeaderProps {
  children?: ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/** 共用顶部栏；总览只展示窗口控件，不调用真实桌面 API。 */
export function WorkspaceHeader({ sidebarCollapsed, onToggleSidebar, children }: WorkspaceHeaderProps) {
  const slot=useContext(HeaderSlot);
  const native = isTauri();
  const preview = document.documentElement.dataset.uiPreview === 'true';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      void appWindow.isMaximized().then(value => { if (!disposed) setMaximized(value); }).catch(() => {});
    };
    refresh();
    void appWindow.onResized(refresh).then(off => {
      if (disposed) off(); else { unlisten = off; refresh(); }
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [native]);

  async function operate(action: 'minimize' | 'maximize' | 'close') {
    if (!native) return;
    const appWindow = getCurrentWindow();
    try {
      if (action === 'minimize') await appWindow.minimize();
      else if (action === 'close') await appWindow.close();
      else {
        await appWindow.toggleMaximize();
        setMaximized(await appWindow.isMaximized());
      }
    } catch {
      notifyOperation('窗口操作未完成，请重试。', { tone: 'error' });
    }
  }

  return <header className="site-header" data-slot="workspace-header" data-window-controls={native || preview} onMouseDown={dragWindow}>
    <OperationToast />
    <Button variant="ghost" size="icon-sm" className="sidebar-trigger" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar"><PanelLeft /></Button>
    <div className="workspace-header-slot" ref={slot?.setTarget}><div className="workspace-header-default">{children}</div></div>
    <div className="site-header-actions">
      {(native || preview) && <div className="window-controls" role="group" aria-label={preview ? '窗口控制（总览仅展示）' : '窗口控制'}>
        <Button variant="ghost" size="app" className="window-control h-full w-11 rounded-none" aria-label="最小化窗口" title="最小化" disabled={!native} onClick={() => void operate('minimize')}><Minus /></Button>
        <Button variant="ghost" size="app" className="window-control h-full w-11 rounded-none" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} disabled={!native} onClick={() => void operate('maximize')}>{maximized ? <Copy /> : <Square />}</Button>
        <Button variant="ghost" size="app" className="window-control window-control--close h-full w-11 rounded-none" aria-label="关闭窗口" title="关闭" disabled={!native} onClick={() => void operate('close')}><X /></Button>
      </div>}
    </div>
  </header>;
}
