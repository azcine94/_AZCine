import { UILink } from './components/ui/ui-link.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Button } from './components/ui/button.tsx';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { settingsGroups, settingsTitle } from './settings-navigation.ts';
import type { SettingsIconName } from './settings-navigation.ts';
import type { Route } from './routes.ts';
import type { Theme } from './theme.ts';
import type { WorkspaceController } from './use-workspace.ts';
import type { PiController } from './use-pi.ts';
import type { NewsController } from './use-news.ts';
import type { EditorialController } from './use-news-editorial.ts';
import type { useDesktopCheck } from './use-desktop-check.ts';
import type { CheckState } from './desktop-contract.ts';
import { DataSettings, WorkspaceGate } from './workspace-panels.tsx';
import { RuntimeInfo } from './pi-panels.tsx';
import { AppUpdatePanel } from './app-update-panel.tsx';
import type { AppUpdateController } from './use-app-update.ts';
import { PiProviderPanel } from './pi-provider-panel.tsx';
import type { PiProvidersController } from './use-pi-providers.ts';
import { NewsSourceManager, NewsSourceEditor, NewsFeed } from './news-panels.tsx';
import { NewsPreferences } from './news-preferences-panel.tsx';
import { NewsProcessingPanel } from './news-processing-panel.tsx';
import type { NewsProcessingController } from './use-news-processing.ts';

const iconPaths: Record<SettingsIconName, ReactNode> = {
  appearance: <><path d="m12 3 2 3 4-1 1 4 3 2-3 2 1 4-4 1-2 3-2-3-4 1-1-4-3-2 3-2-1-4 4-1Z" /><circle cx="12" cy="12" r="3" /></>,
  model: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M8 15h3" /></>,
  skill: <><path d="M7 3h8l4 4v14H5V3h2Zm7 0v5h5M8 12h8M8 16h5" /></>,
  extension: <path d="M8 4h3a2 2 0 1 1 4 0h5v5a2 2 0 1 0 0 4v7h-7a2 2 0 1 0-4 0H4v-7a2 2 0 1 0 0-4V4h4Z" />,
  folder: <path d="M3 7V4h7l2 3h9v13H3V7Z" />,
  source: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  filter: <><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 9h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  diagnostics: <><path d="m4 4 16 16M16 4l4 4M4 20l7-7M13 11l7-7" /><path d="M3 3h4v4H3Z" /></>,
};

function SettingsIcon({ name }: { name: SettingsIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

function AppearanceSettings({ theme, selectTheme }: { theme: Theme; selectTheme: (theme: Theme) => void }) {
  return <section className="settings-page">
    <header className="settings-page-header"><h2>常用设置</h2><p className="subtle">调整工作台的显示偏好。</p></header>
    <div className="settings-row"><div><h3>外观主题</h3><p className="meta">默认使用浅色。手动选择后，记住这台设备的偏好。</p></div>
      <div className="settings-theme-options" aria-label="外观主题">{(['light', 'dark'] as const).map(value => <Button variant="app-control" key={value} type="button" className="settings-theme-option" aria-pressed={theme === value} onClick={() => selectTheme(value)}>
        <span className={`settings-theme-preview settings-theme-preview--${value}`} aria-hidden="true"><span /><span><i /><i /><i /></span></span>
        <span>{value === 'light' ? '浅色' : '深色'}</span>
      </Button>)}</div>
    </div>
  </section>;
}

function CheckResult({ state }: { state: CheckState }) {
  switch (state.status) {
    case 'idle': return <><h3>还未检查</h3><p>主动检查后才会调用 Rust 和独立临时数据库。</p></>;
    case 'loading': return <><h3>正在检查桌面连接</h3><p>等待 Rust 和临时数据库响应，请稍候。</p></>;
    case 'error': return <><h3>连接检查失败</h3><p>{state.message}</p></>;
    case 'success': return <><h3>桌面连接正常</h3><p>Rust 往返、临时库写入 / 读取和事务回滚均已通过；检查产物保留。</p><p className="meta">SQLite {state.report.sqliteVersion} · 开发版本 {state.report.appVersion} · 请求 {state.report.requestId}</p></>;
  }
}

interface SettingsProps {
  updatePreview?: AppUpdateController;
  route: Route;
  sourceId: string | null;
  workspace: WorkspaceController;
  pi: PiController;
  providers: PiProvidersController;
  news: NewsController;
  editorial: EditorialController;
  processing: NewsProcessingController;
  desktop: ReturnType<typeof useDesktopCheck>;
  theme: Theme;
  selectTheme: (theme: Theme) => void;
}

export function SettingsWorkspace({ route, sourceId, workspace, pi, providers, news, editorial, processing, desktop, theme, selectTheme, updatePreview }: SettingsProps) {
  const content = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const title = sourceId ? (sourceId === 'new' ? '信源管理' : '编辑信源') : settingsTitle(route) ?? '设置';
  useLayoutEffect(() => {
    const area = content.current;
    const heading = area?.querySelector<HTMLHeadingElement>('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    area?.scrollTo(0, positions.current[route] ?? 0);
    return () => { if (area) positions.current[route] = area.scrollTop; };
  }, [route]);

  let page: ReactNode;
  if (route === 'settings') page = <AppearanceSettings theme={theme} selectTheme={selectTheme} />;
  else if (route === 'settings/models') page = <PiProviderPanel model={providers} pi={pi} />;
  else if (route === 'settings/runtime') page = <section className="settings-page"><header className="settings-page-header"><h2>工作目录与环境</h2><p className="subtle">查看本应用的原版 Pi，设置下次连接使用的工作目录。</p></header><p className="settings-help" role="status">{pi.action==='连接'||pi.snapshot?.connection==='connecting'?'正在自动连接本应用 Pi…':pi.snapshot?.connection==='ready'?'本应用 Pi 已连接。':'本应用 Pi 尚未连接，可在模型服务商页重试。'}</p>{(pi.error??pi.snapshot?.error?.message)&&<Feedback as="p" tone="error" className="form-error" role="alert">{pi.error??pi.snapshot?.error?.message}</Feedback>}<RuntimeInfo model={pi} expanded /><UILink variant="text" className="foundation-link" href="#settings/models">前往模型服务商 →</UILink></section>;
  else if (route === 'settings/data') page = <DataSettings model={workspace} />;
  else if (route === 'settings/about') page = <AppUpdatePanel preview={updatePreview} />;
  else if (route === 'settings/diagnostics') page = <section className="settings-page"><header className="settings-page-header"><h2>桌面连接检查</h2><p className="subtle">检查 Rust 与独立临时数据库，不修改业务记录。进入此页不会自动检查。</p></header>
    <div className="foundation-check" data-check-state={desktop.state.status} role="status" aria-live="polite" aria-busy={desktop.state.status === 'loading'}><CheckResult state={desktop.state} /></div>
    <div className="check-actions"><Button variant="app-pill" className="pill on" onClick={() => void desktop.check()} disabled={!desktop.connected || desktop.state.status === 'loading'}>{desktop.state.status === 'loading' ? '正在检查…' : '检查桌面连接'}</Button>{!desktop.connected && <p className="subtle">网页预览不能执行检查，请从项目根运行 npm run dev。</p>}</div>
  </section>;
  else if (!workspace.workspace?.root || workspace.loadError) page = <WorkspaceGate model={workspace} />;
  else if (sourceId === 'new') page = <NewsSourceManager model={news} create />;
  else if (sourceId) page = <NewsSourceEditor model={news} sourceId={sourceId} />;
  else if (route === 'settings/news') page = <NewsSourceManager model={news} />;
  else if (route === 'settings/news/materials') page = <NewsFeed model={news} />;
  else if (route === 'settings/news/processing') page = <NewsProcessingPanel model={editorial} news={news} processing={processing} />;
  else page = <NewsPreferences sources={news.snapshot?.sources??[]} model={editorial} models={pi.snapshot?.models ?? []} section={route === 'settings/news/ai' ? 'ai' : route === 'settings/news/automation' ? 'automation' : 'domains'} />;

  return <div className="settings-layout">
    <aside className="settings-sidebar"><nav aria-label="设置分类">{settingsGroups.map((group, index) => <section className="settings-nav-group" key={group.title} aria-labelledby={`settings-group-${index}`}>
      <h2 id={`settings-group-${index}`}>{group.title}</h2>{group.items.map(item => <UILink variant="navigation" key={item.route} className="settings-nav-item" href={`#${item.route}`} aria-current={route === item.route || !!sourceId && item.route === 'settings/news' ? 'page' : undefined}><SettingsIcon name={item.icon} /><span>{item.title}</span></UILink>)}
    </section>)}</nav></aside>
    <div ref={content} className="settings-content" role="region" aria-label={`${title}内容`} tabIndex={0}>{page}</div>
  </div>;
}
