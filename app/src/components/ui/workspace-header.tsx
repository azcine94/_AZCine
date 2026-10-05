import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react';
import { isTauri } from '../../desktop-api.ts';
import { Button } from './button.tsx';

interface WorkspaceHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/** 共用顶部栏；总览只展示窗口控件，不调用真实桌面 API。 */
export function WorkspaceHeader({ sidebarCollapsed, onToggleSidebar }: WorkspaceHeaderProps) {
  const native = isTauri();
  const preview = document.documentElement.dataset.uiPreview === 'true';
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState('');

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

  async function operate(action: 'minimize' | 'maximize' | 'close' | 'drag') {
    if (!native) return;
    setError('');
    const appWindow = getCurrentWindow();
    try {
      if (action === 'minimize') await appWindow.minimize();
      else if (action === 'close') await appWindow.close();
      else if (action === 'drag') await appWindow.startDragging();
      else {
        await appWindow.toggleMaximize();
        setMaximized(await appWindow.isMaximized());
      }
    } catch {
      setError('窗口操作未完成，请重试。');
    }
  }

  function drag(event: MouseEvent<HTMLElement>) {
    if (!native || event.button !== 0 || !(event.target instanceof Element)) return;
    // 顶部空白可拖动；交互控件及其图标保持正常点击。
    if (event.target.closest('button,a,input,select,textarea,[role="button"],[contenteditable="true"]')) return;
    event.preventDefault();
    void operate(event.detail === 2 ? 'maximize' : 'drag');
  }

  return <header className="site-header" data-slot="workspace-header" data-window-controls={native || preview} onMouseDown={drag}>
    <Button variant="ghost" size="icon-sm" className="sidebar-trigger" onClick={onToggleSidebar} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar"><PanelLeft /></Button>
    <div className="site-header-actions">
      {error && <span className="window-action-error" role="alert">{error}</span>}
      {(native || preview) && <div className="window-controls" role="group" aria-label={preview ? '窗口控制（总览仅展示）' : '窗口控制'}>
        <Button variant="ghost" size="app" className="window-control h-full w-11 rounded-none" aria-label="最小化窗口" title="最小化" disabled={!native} onClick={() => void operate('minimize')}><Minus /></Button>
        <Button variant="ghost" size="app" className="window-control h-full w-11 rounded-none" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} disabled={!native} onClick={() => void operate('maximize')}>{maximized ? <Copy /> : <Square />}</Button>
        <Button variant="ghost" size="app" className="window-control window-control--close h-full w-11 rounded-none" aria-label="关闭窗口" title="关闭" disabled={!native} onClick={() => void operate('close')}><X /></Button>
      </div>}
    </div>
  </header>;
}
