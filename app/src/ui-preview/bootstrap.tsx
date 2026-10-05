import { Component } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import UIPreviewApp from './main.tsx';

class SceneBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <div className="catalog-error" role="alert"><h1>这个预览发生错误</h1><p>{this.state.error}</p><p>此场景没有展示成功，保留在清单中待修复。</p></div> : this.props.children;
  }
}

const mount = document.getElementById('root');
if (!mount) throw new Error('UI 总览缺少挂载节点');
const root = import.meta.hot?.data.previewRoot ?? createRoot(mount);
if (import.meta.hot) import.meta.hot.data.previewRoot = root;
root.render(<SceneBoundary><UIPreviewApp /></SceneBoundary>);
