import { EmptyState } from './components/ui/empty-state.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { WorkspaceHeader } from './components/ui/workspace-header.tsx';
import { Button } from './components/ui/button.tsx';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { pages, pageTitle, resolveRoute, projectTarget, navigationPage, newsSourceTarget, sourceTarget } from './routes.ts';
import type { PageId, Route } from './routes.ts';
import { useTheme } from './use-theme.ts';
import { useDesktopCheck } from './use-desktop-check.ts';
import logo from './assets/logo-lockup.png';
import { useWorkspace } from './use-workspace.ts';
import type { WorkspaceController } from './use-workspace.ts';
import { WorkspaceGate, TodoPanel } from './workspace-panels.tsx';
import { useProjects } from './use-projects.ts';
import type { ProjectsController } from './use-projects.ts';
import { ProjectsOverview, ProjectEditor, DeliveryList } from './projects-panels.tsx';
import { deriveDeliveries } from './projects-contract.ts';
import { usePi } from './use-pi.ts';
import { usePiProviders } from './use-pi-providers.ts';
import { SettingsWorkspace } from './settings-panels.tsx';
import { AgentPanel } from './pi-agent-panel.tsx';
import { useModelRanking } from './use-model-ranking.ts';
import { ModelRankingPanel } from './model-ranking-panel.tsx';
import { useNews } from './use-news.ts';
import { useNewsEditorial } from './use-news-editorial.ts';
import type { EditorialController } from './use-news-editorial.ts';

import {useNewsReader} from './use-news-reader.ts';
import type {NewsReaderController} from './use-news-reader.ts';
import type {ArticleDetail} from './news-reader-contract.ts';
import {NewsReaderList,NewsArticlePage,NewsStoryPage} from './news-reader-panels.tsx';
import { NewsProcessingPanel } from './news-processing-panel.tsx';
import { useNewsProcessing } from './use-news-processing.ts';
import { useIdeas } from './use-ideas.ts';
import type { IdeasController } from './use-ideas.ts';
import { IdeasPanel } from './ideas-panels.tsx';

const iconPaths: Record<PageId, ReactNode> = {
  today: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4m8-4v4M3 10h18m-13 5h3" /></>,
  projects: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  news: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  models: <path d="M4 21h17M6 17v-5h3v5m3 0V7h3v10m3 0V3h3v14" />,
  ideas: <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z" />,
  agent: <path d="m5 7 5 5-5 5m8 0h6" />,
  jobs: <path d="M4 12h3l3-8 4 16 3-8h3" />,
  settings: <path d="M5 4v16m7-16v16m7-16v16M2 8h6m1 8h6m1-7h6" />,
};
function Icon({ name }: { name: PageId }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}
function subscribeRoute(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
const routeSnapshot = () => resolveRoute(window.location.hash);

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <EmptyState as="div" className="foundation-empty"><h2>{title}</h2><p>{children}</p></EmptyState>;
}
function Today({ model, projects, editorial, reader, ideas, targetId }: { model: WorkspaceController; projects: ProjectsController; editorial: EditorialController; reader:ReturnType<typeof useNewsReader>; ideas: IdeasController; targetId: string | null }) {
  const deliveries = deriveDeliveries(projects.projects);
  const next = deliveries.find(item => item.dueDate);
  return <>
    <div className="today-cards today-cards-b">
      <section className="today-card review-card">
        <div className="card-heading"><span className="card-kicker">待核对</span><span className="card-state">未接入</span></div>
        <div className="review-card-body"><h2>还没有可核对的变更</h2><p className="card-description">资料导入后，变更会先放在这里等你核对。</p></div>
      </section>
      <section className="today-card today-tasks-card">
        <header className="card-heading"><h2>今天要做</h2><span className="card-state">本机保存</span></header>
        <TodoPanel model={model} projects={projects.projects} projectsLoading={projects.loading} projectsError={projects.loadError} ideas={ideas.ideas} targetId={targetId} />
      </section>
      <section className="today-card today-delivery-card">
        <header className="card-heading"><h2>接下来交付</h2><UILink variant="text" className="foundation-link" href="#projects">查看项目</UILink></header>
        {<>{projects.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{projects.loadError}</Feedback>}{projects.loading && <p className="meta" role="status">正在读取交付…</p>}{next && <div className="home-due-feature"><time dateTime={next.dueDate} aria-label={next.dueDate}><span className="meta">{next.dueDate.slice(0, 4)} 年</span><strong>{next.dueDate.slice(5).replace('-', '/')}</strong></time><div><span className="meta">最近交付</span><strong>{deliveries.filter(item => item.dueDate === next.dueDate).length} 项待交</strong></div></div>}<DeliveryList projects={projects.projects} compact /></>}
      </section>
      <section className="today-card today-news-card">
        <header className="card-heading"><h2>今日资讯</h2><UILink variant="text" className="foundation-link" href="#news">查看资讯</UILink></header>
        {reader.snapshot?.editions.find(e=>e.kind==='daily') ? <div className="news-home-summary"><p className="meta">{reader.snapshot.editions.find(e=>e.kind==='daily')!.date} · 日报</p>{reader.snapshot.editions.find(e=>e.kind==='daily')!.main.slice(0,3).map(a=><p key={a.id}><UILink variant="text" className="foundation-link" href={`#news/items/${a.id}`}>{a.titleZh}</UILink></p>)}{!reader.snapshot.editions.find(e=>e.kind==='daily')!.main.length&&<p className="subtle">本期暂无符合规则的条目。</p>}</div> : editorial.snapshot?.editions[0] ? <div className="news-home-summary"><p className="meta">{editorial.snapshot.editions[0].date} · v{editorial.snapshot.editions[0].version}{editorial.snapshot.editions[0].incomplete && ' · 覆盖不完整'}</p>{editorial.snapshot.editions[0].overviewIds.slice(0, 3).map(id => { const event = editorial.snapshot!.editions[0].events.find(e => e.id === id); return event && <p key={id}><UILink variant="text" className="foundation-link" href={`#news/events/${id}`}>{event.draft.title}</UILink></p>; })}{!editorial.snapshot.editions[0].overviewIds.length && <p className="subtle">本期没有符合规则的看点，不凑数。</p>}</div> : <Empty title="暂无资讯刊期">采集与整理在设置的资讯管理中操作，生成后的日报在资讯页阅读。</Empty>}
      </section>
    </div>
    <div className="foundation-job"><span>后台队列未接入</span><UILink variant="plain" href="#jobs">查看后台任务</UILink></div>
  </>;
}
function Placeholder({ route }: { route: Route }) {
  switch (route) {
    case 'jobs': return <Empty title="自动后台队列尚未接入">资讯手动采集的进度与记录在资讯管理查看。关闭桌面窗口即退出，采集中断不报成功；暂不收托盘。</Empty>;
    default: return <Empty title="没有这个页面">请从左侧导航打开页面。</Empty>;
  }
}
export default function App() {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const theme = useTheme();
  const desktop = useDesktopCheck();
  const workspace = useWorkspace();
  const projects = useProjects(workspace.workspace?.root ?? null);
  const piRoot = workspace.loadError ? null : workspace.workspace?.root ?? null;
  const pi = usePi(piRoot);
  const providers = usePiProviders(piRoot, route === 'settings/models' && !!pi.snapshot && pi.snapshot.connection !== 'connecting' && !pi.action, pi);
  const rankings = useModelRanking(workspace.loadError ? null : workspace.workspace?.root ?? null, route === 'models');
  const news = useNews(workspace.workspace?.root ?? null);
  const editorial = useNewsEditorial(workspace.workspace?.root ?? null);
  const processing = useNewsProcessing(workspace.workspace?.root ?? null, !workspace.loadError && (route === 'settings/news/processing' || route === 'jobs'), editorial.active);
  const ideas = useIdeas(workspace.workspace?.root ?? null);
  return <WorkspaceView route={route} {...theme} desktop={desktop} workspace={workspace} projects={projects} pi={pi} providers={providers} rankings={rankings} news={news} editorial={editorial} processing={processing} ideas={ideas} />;
}

export interface WorkspaceViewProps {
  readerPreview?:NewsReaderController; articlePreview?:ArticleDetail;
  route: Route; theme: ReturnType<typeof useTheme>['theme']; toggle: ReturnType<typeof useTheme>['toggle']; selectTheme: ReturnType<typeof useTheme>['selectTheme']; warning: string;
  desktop: ReturnType<typeof useDesktopCheck>; workspace: WorkspaceController; projects: ProjectsController; pi: ReturnType<typeof usePi>; providers: ReturnType<typeof usePiProviders>; rankings: ReturnType<typeof useModelRanking>; news: ReturnType<typeof useNews>; editorial: EditorialController; processing: ReturnType<typeof useNewsProcessing>; ideas: IdeasController;
}
export function WorkspaceView({route, theme, toggle, selectTheme, warning, desktop, workspace, projects, pi, providers, rankings, news, editorial, processing, ideas,readerPreview,articlePreview}: WorkspaceViewProps) {
  const title = pageTitle(route);
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const newsTarget = newsSourceTarget(route);
  const target = projectTarget(route);
  const activePage = navigationPage(route);
  const nativeReader=useNewsReader(workspace.workspace?.root??null,activePage==='news'||activePage==='today');
  const reader=document.documentElement.dataset.uiPreview==='true'&&readerPreview?readerPreview:nativeReader;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width:1100px)').matches);
  const sourceId = sourceTarget(route);
  useEffect(() => {
    if (activePage === 'today' && sourceId) {
      const todo = workspace.workspace?.todos.find(t => t.id === sourceId);
      if (todo) workspace.setFilter(todo.completed ? 'completed' : 'incomplete');
    }
  }, [activePage, sourceId, workspace.workspace?.todos]);
  useLayoutEffect(() => {
    document.title = `AZCine · ${title}`;
    if (navigationPage(route) !== 'settings') heading.current?.focus({ preventScroll: true });
    const area = scrollArea.current;
    area?.scrollTo(0, positions.current[route] ?? 0);
    return () => { if (area) positions.current[route] = area.scrollTop; };
  }, [route, title]);
  return <>
    {warning && <p className="theme-warning" role="status">{warning}</p>}
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <aside className="side" id="workspace-sidebar">
        <UILink variant="navigation" className="brand" href="#today" aria-label="AZCine 今天"><img className="brand-lockup" src={logo} alt="AZCine" /></UILink>
        <nav aria-label="主导航">{[{title:'工作台',ids:['today','projects','news','models','ideas']},{title:'工具',ids:['agent','jobs']}].map(group => <section className="nav-group" key={group.title}><h2>{group.title}</h2>{pages.filter(page=>group.ids.includes(page.id)).map(page => <UILink variant="navigation" key={page.id} className="nav-item" title={page.title} aria-label={page.title} href={`#${page.id}`} aria-current={activePage === page.id ? 'page' : undefined}><Icon name={page.icon} /><span>{page.title}</span></UILink>)}</section>)}</nav>
        <footer className="side-footer"><div className="side-footer-actions"><UILink variant="navigation" className="nav-item" title="设置" aria-label="设置" href="#settings" aria-current={activePage === 'settings' ? 'page' : undefined}><Icon name="settings" /><span>设置</span></UILink><Button variant="ghost" size="icon-sm" className="theme-button" onClick={toggle} aria-label={theme === 'dark' ? '切换浅色' : '切换深色'} title={theme === 'dark' ? '切换浅色' : '切换深色'} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun /> : <Moon />}</Button></div></footer>
      </aside>
      <main className="workspace" data-page={route}>
        <WorkspaceHeader sidebarCollapsed={sidebarCollapsed} onToggleSidebar={()=>setSidebarCollapsed(value=>!value)} />
        <header className="page-heading"><div className="page-name">{activePage === 'settings' && <UILink variant="plain" className="settings-back" href="#today" aria-label="返回工作台"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg></UILink>}<h1 tabIndex={-1} ref={heading}>{activePage === 'settings' ? '设置' : title}</h1></div>{(activePage === 'projects' || activePage === 'ideas') && <span className="meta">{activePage === 'projects' ? '文档与交付' : '想法先留下，不必立刻变成任务'}</span>}</header>
        <div ref={scrollArea} className={`workspace-scroll${activePage === 'settings' ? ' workspace-scroll--settings' : ''}${target && projects.drafts[target.projectId] && workspace.workspace?.root && !workspace.loadError ? ' workspace-scroll--project-document' : ''}`} role="region" aria-label={`${title}内容`} tabIndex={0}>
        {activePage === 'today' ? (workspace.workspace?.root && !workspace.loadError ? <Today model={workspace} projects={projects} editorial={editorial} reader={reader} ideas={ideas} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'ideas' ? (workspace.workspace?.root && !workspace.loadError ? <IdeasPanel model={ideas} projects={projects.projects} projectsLoading={projects.loading} projectsError={projects.loadError} workspace={workspace} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'projects' ? (workspace.workspace?.root && !workspace.loadError ? target ? <ProjectEditor key={target.projectId} model={projects} projectId={target.projectId} targetRow={target.row} /> : <ProjectsOverview model={projects} create={route === 'projects/new'} /> : <WorkspaceGate model={workspace} />) : route === 'models' ? <ModelRankingPanel model={rankings} hasRoot={!!workspace.workspace?.root && !workspace.loadError} rootError={workspace.loadError} /> : route === 'agent' ? (workspace.workspace?.root && !workspace.loadError ? <AgentPanel model={pi} /> : <WorkspaceGate model={workspace} />) : activePage === 'settings' ? <SettingsWorkspace route={route} sourceId={newsTarget} workspace={workspace} pi={pi} providers={providers} news={news} editorial={editorial} processing={processing} desktop={desktop} theme={theme} selectTheme={selectTheme} /> : activePage === 'news' ? (workspace.workspace?.root && !workspace.loadError ? route.startsWith('news/items/') ? <NewsArticlePage key={route} id={route.slice(11)} root={workspace.workspace.root} news={news} onBookmark={()=>void reader.refresh()} preview={document.documentElement.dataset.uiPreview==='true'?articlePreview:undefined} /> : route.startsWith('news/stories/') ? <NewsStoryPage id={route.slice(13)} model={reader} /> : route.startsWith('news/events/') ? <NewsArticlePage key={route} id={route.slice(12)} root={workspace.workspace.root} news={news} onBookmark={()=>void reader.refresh()} preview={document.documentElement.dataset.uiPreview==='true'?articlePreview:undefined} /> : <NewsReaderList model={reader} legacy={editorial} news={news} /> : <WorkspaceGate model={workspace} />) : route === 'jobs' ? (workspace.workspace?.root && !workspace.loadError ? <NewsProcessingPanel model={editorial} news={news} processing={processing} /> : <WorkspaceGate model={workspace} />) : <Placeholder route={route} />}
        </div>
      </main>
    </div>
  </>;
}
