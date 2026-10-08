import {NewsDailyPanel} from './news-daily-panel.tsx';
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
import { listen,isTauri } from './desktop-api.ts';
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
import { TodayNewsPanel } from './today-news-panel.tsx';
import { usePiProviders } from './use-pi-providers.ts';
import { SettingsWorkspace } from './settings-panels.tsx';
import { AgentPanel,AgentChat } from './pi-agent-panel.tsx';
import { AgentSidebar } from './components/ui/agent-sidebar.tsx';
import { AgentEntry } from './components/ui/agent-entry.tsx';
import { useAgentData } from './use-agent-data.ts';
import {useAgentJobs} from './use-agent-jobs.ts';
import {AgentJobsPanel} from './agent-jobs-panel.tsx';
import { AgentDraftsPanel } from './agent-drafts-panel.tsx';
import { PiResourcesPanel } from './pi-resources-panel.tsx';
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
import { useBookkeeping } from './use-bookkeeping.ts';
import type { BookkeepingController } from './use-bookkeeping.ts';
import { useTaskPanel } from './use-task-panel.ts';
import type { TaskPanelController } from './use-task-panel.ts';
import { TaskPanel, TaskPanelActions } from './task-panel-panels.tsx';
import { BookkeepingPanel } from './bookkeeping-panels.tsx';
import { StatusDot } from './components/ui/status-dot.tsx';
import { ServerCredentialsPanel } from './server-credentials-panel.tsx';
import { useServerCredentials } from './use-server-credentials.ts';
import { DevEnvironmentPanel } from './dev-environment-panel.tsx';
import { useDevEnvironment } from './use-dev-environment.ts';
import type { EnvironmentController } from './use-dev-environment.ts';

const iconPaths: Record<PageId, ReactNode> = {
  'servers-credentials': <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" /></>,
  today: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4m8-4v4M3 10h18m-13 5h3" /></>,
  projects: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  news: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  models: <path d="M4 21h17M6 17v-5h3v5m3 0V7h3v10m3 0V3h3v14" />,
  ideas: <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z" />,
  bookkeeping: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 14h4M7 17h2" /></>,
  agent: <path d="m5 7 5 5-5 5m8 0h6" />,
  'task-panel': <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 8v8m4-8v5m4-5v3" /></>,
  jobs: <path d="M4 12h3l3-8 4 16 3-8h3" />,
  'dev-environment': <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10" /></>,
  resources: <><path d="M4 4h6l2 3h8v14H4Z" /><path d="M8 12h8M8 16h5" /></>,
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
function Today({ model, projects, editorial, reader, ideas, targetId, agentData, pi }: { pi:ReturnType<typeof usePi>; agentData:ReturnType<typeof useAgentData>; model: WorkspaceController; projects: ProjectsController; editorial: EditorialController; reader:ReturnType<typeof useNewsReader>; ideas: IdeasController; targetId: string | null }) {
  const deliveries = deriveDeliveries(projects.projects);
  const next = deliveries.find(item => item.dueDate);
  return <>
    <div className="today-cards today-cards-b">
      <section className="today-card review-card">
        <div className="card-heading"><span className="card-kicker">待核对</span><span className="card-state">{agentData.error?'读取失败':`${agentData.drafts.filter(d=>d.status!=='applied').length} 份草案`}</span></div>
        <div className="review-card-body"><h2>{agentData.error?'草案记录尚未读到':agentData.drafts.some(d=>d.status!=='applied')?'有草案等待本人核对':'还没有可核对的变更'}</h2><p className="card-description">{agentData.error||'Agent完成的业务草案会保存在这里；核对后再写入正式记录。'}</p><AgentDraftsPanel model={agentData} pi={pi}/></div>
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
        <header className="card-heading"><h2>最新日报</h2><UILink variant="text" className="foundation-link" href="#news/daily">阅读整期</UILink></header>
        <TodayNewsPanel reader={reader} editorial={editorial}/>
      </section>
    </div>
    <div className="foundation-job"><span>后台整理与资讯任务</span><UILink variant="plain" href="#jobs">查看后台任务</UILink></div>
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
  const pi = usePi(piRoot,{resourcesVisible:route==='resources'});
  const providers = usePiProviders(piRoot, route === 'settings/models' && !!pi.snapshot && pi.snapshot.connection !== 'connecting' && !pi.action, pi);
  const rankings = useModelRanking(workspace.loadError ? null : workspace.workspace?.root ?? null, route === 'models');
  const news = useNews(workspace.workspace?.root ?? null);
  const editorial = useNewsEditorial(workspace.workspace?.root ?? null);
  const processing = useNewsProcessing(workspace.workspace?.root ?? null, !workspace.loadError && (route === 'settings/news/processing' || route === 'jobs'), editorial.active);
  const ideas = useIdeas(workspace.workspace?.root ?? null);
  const bookkeeping = useBookkeeping(workspace.loadError ? null : workspace.workspace?.root ?? null);
  return <WorkspaceView route={route} {...theme} desktop={desktop} workspace={workspace} projects={projects} pi={pi} providers={providers} rankings={rankings} news={news} editorial={editorial} processing={processing} ideas={ideas} bookkeeping={bookkeeping} />;
}

export interface WorkspaceViewProps {
  serverManagerPreview?: string;
  environmentPreview?:EnvironmentController;
  taskPanelPreview?:TaskPanelController;
  agentDataPreview?:ReturnType<typeof useAgentData>;agentJobsPreview?:ReturnType<typeof useAgentJobs>;readerPreview?:NewsReaderController; articlePreview?:ArticleDetail;
  route: Route; theme: ReturnType<typeof useTheme>['theme']; toggle: ReturnType<typeof useTheme>['toggle']; selectTheme: ReturnType<typeof useTheme>['selectTheme']; warning: string;
  desktop: ReturnType<typeof useDesktopCheck>; workspace: WorkspaceController; projects: ProjectsController; pi: ReturnType<typeof usePi>; providers: ReturnType<typeof usePiProviders>; rankings: ReturnType<typeof useModelRanking>; news: ReturnType<typeof useNews>; editorial: EditorialController; processing: ReturnType<typeof useNewsProcessing>; ideas: IdeasController; bookkeeping: BookkeepingController;
}
export function WorkspaceView({route, theme, toggle, selectTheme, warning, desktop, workspace, projects, pi, providers, rankings, news, editorial, processing, ideas, bookkeeping,readerPreview,articlePreview,agentDataPreview,agentJobsPreview,taskPanelPreview,serverManagerPreview,environmentPreview}: WorkspaceViewProps) {
  const serverManager = useServerCredentials(workspace.workspace?.root ?? null, document.documentElement.dataset.uiPreview === 'true' ? serverManagerPreview ?? 'normal' : undefined);
  const title = pageTitle(route.startsWith('bookkeeping/') ? 'bookkeeping' : route === 'projects/new' ? 'projects' : route === 'settings/news/sources/new' ? 'settings/news' : route);
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, number>>({});
  const newsReturn = useRef('#news');
  if (route === 'news' || route === 'news/daily' || route.startsWith('news/daily/')) newsReturn.current = `#${route}`;
  const newsTarget = newsSourceTarget(route);
  const target = projectTarget(route);
  const activePage = navigationPage(route);
  const nativeEnvironment = useDevEnvironment(route === 'dev-environment');
  const environment = document.documentElement.dataset.uiPreview === 'true' && environmentPreview ? environmentPreview : nativeEnvironment;
  const nativeTaskPanel = useTaskPanel(workspace.loadError ? null : workspace.workspace?.root ?? null);
  const taskPanel = document.documentElement.dataset.uiPreview === 'true' && taskPanelPreview ? taskPanelPreview : nativeTaskPanel;
  const nativeReader=useNewsReader(workspace.workspace?.root??null,activePage==='news'||activePage==='today');
  const reader=document.documentElement.dataset.uiPreview==='true'&&readerPreview?readerPreview:nativeReader;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width:1100px)').matches);
  const sourceId = sourceTarget(route);
  const [agentOpen,setAgentOpen]=useState(false);
  const agentEntry=useRef<HTMLButtonElement>(null);
  const nativeAgentJobs=useAgentJobs(workspace.loadError?null:workspace.workspace?.root??null);
  const nativeAgentData=useAgentData(workspace.loadError?null:workspace.workspace?.root??null);
  const agentJobs=document.documentElement.dataset.uiPreview==='true'&&agentJobsPreview?agentJobsPreview:nativeAgentJobs;
  const agentData=document.documentElement.dataset.uiPreview==='true'&&agentDataPreview?agentDataPreview:nativeAgentData;
  const agentWaiting=pi.runtimeSummary?.conversations.filter(row=>row.waiting).length??0;
  const agentSource={module:newsTarget&&newsTarget!=='new'?'news':activePage==='settings'?'settings':activePage,page:route,objectId:target?.projectId??sourceId??(newsTarget&&newsTarget!=='new'?'source:'+newsTarget:activePage==='bookkeeping'&&route!=='bookkeeping'&&route!=='bookkeeping/new'?route.slice(12):route.startsWith('news/items/')?route.slice(11):route.startsWith('news/stories/')?route.slice(13):route.startsWith('news/events/')?route.slice(12):null)};
  const [businessPending,setBusinessPending]=useState<string[]>([]);
  useEffect(()=>{
    if(!workspace.workspace?.root||!isTauri())return;
    let disposed=false,off:(()=>void)|undefined;
    void listen<string[]>('azcine-business-data-changed',event=>{if(disposed)return;setBusinessPending(previous=>[...new Set([...previous,...event.payload,...(event.payload.some(module=>module==='projects'||module==='today')?['workspace']:[])])]);}).then(stop=>{if(disposed)stop();else off=stop;});
    return()=>{disposed=true;off?.();};
  },[workspace.workspace?.root]);
  useEffect(()=>{
    if(!businessPending.length)return;
    const remaining:string[]=[];
    for(const module of businessPending){
      if(module==='workspace'){if(workspace.busy||workspace.loading){remaining.push(module);continue;}void workspace.refresh();}
      else if(module==='projects'){if(projects.busy||projects.loading){remaining.push(module);continue;}void projects.refresh();}
      else if(module==='ideas'){if(ideas.busy||ideas.loading){remaining.push(module);continue;}void ideas.refresh();}
      else if(module==='bookkeeping'){if(bookkeeping.busy||bookkeeping.loading){remaining.push(module);continue;}void bookkeeping.refresh();}
      else if(module==='news'){if(news.busy||news.loading){remaining.push(module);continue;}void news.refresh(false);}
    }
    if(remaining.length!==businessPending.length)setBusinessPending(remaining);
  },[businessPending,workspace.busy,workspace.loading,projects.busy,projects.loading,ideas.busy,ideas.loading,bookkeeping.busy,bookkeeping.loading,news.busy,news.loading]);
  useEffect(()=>{if(route!=='agent'&&activePage!=='servers-credentials'&&(pi.source.module!==agentSource.module||pi.source.page!==agentSource.page||pi.source.objectId!==agentSource.objectId))void pi.openSource(agentSource);},[route,agentSource.module,agentSource.objectId,pi.source.module,pi.source.page,pi.source.objectId]);

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
        <nav aria-label="主导航">{[{title:'工作台',ids:['today','projects','news','models','ideas','bookkeeping','servers-credentials']},{title:'工具',ids:['agent','task-panel','jobs','dev-environment','resources']}].map(group => <section className="nav-group" key={group.title}><h2>{group.title}</h2>{pages.filter(page=>group.ids.includes(page.id)).map(page => <UILink variant="navigation" key={page.id} className={`nav-item${page.id === 'servers-credentials' && serverManager.unreadReminderCount ? ' nav-item--notice' : ''}`} title={page.id === 'servers-credentials' && serverManager.unreadReminderCount ? `${page.title} · ${serverManager.reminderLabel}` : page.title} aria-label={page.id === 'servers-credentials' && serverManager.unreadReminderCount ? `${page.title}，${serverManager.reminderLabel}` : page.title} href={`#${page.id}`} aria-current={activePage === page.id ? 'page' : undefined}><Icon name={page.icon} /><span>{page.title}</span>{page.id === 'servers-credentials' && serverManager.unreadReminderCount > 0 && <StatusDot className="nav-status-dot" tone={serverManager.reminderTone} label={serverManager.reminderLabel} aria-hidden="true" />}</UILink>)}</section>)}</nav>
        <footer className="side-footer"><div className="side-footer-actions"><UILink variant="navigation" className="nav-item" title="设置" aria-label="设置" href="#settings" aria-current={activePage === 'settings' ? 'page' : undefined}><Icon name="settings" /><span>设置</span></UILink><Button variant="ghost" size="icon-sm" className="theme-button" onClick={toggle} aria-label={theme === 'dark' ? '切换浅色' : '切换深色'} title={theme === 'dark' ? '切换浅色' : '切换深色'} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun /> : <Moon />}</Button></div></footer>
      </aside>
      <main className="workspace" data-page={route}>
        <WorkspaceHeader sidebarCollapsed={sidebarCollapsed} onToggleSidebar={()=>setSidebarCollapsed(value=>!value)} />
        <div className="workspace-body"><div className="workspace-main"><header className="page-heading"><div className="page-name">{activePage === 'settings' && <UILink variant="plain" className="settings-back" href="#today" aria-label="返回工作台"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg></UILink>}<h1 tabIndex={-1} ref={heading}>{activePage === 'settings' ? '设置' : title}</h1></div><div className="agent-page-tools">{activePage === 'task-panel' && <TaskPanelActions model={taskPanel} />}{(activePage === 'projects' || activePage === 'ideas') && <span className="meta">{activePage === 'projects' ? '文档与交付' : '想法先留下，不必立刻变成任务'}</span>}{route!=='agent'&&activePage!=='servers-credentials'&&workspace.workspace?.root&&<AgentEntry ref={agentEntry} aria-expanded={agentOpen} waitingCount={agentWaiting} activeCount={pi.runtimeSummary?.active??0} onClick={()=>{setAgentOpen(open=>!open);if(!agentOpen)void pi.openSource(agentSource);}}/>}</div></header>
        <div ref={scrollArea} className={`workspace-scroll${activePage === 'task-panel' ? ' workspace-scroll--task-panel' : ''}${activePage === 'settings' ? ' workspace-scroll--settings' : ''}${target && projects.drafts[target.projectId] && workspace.workspace?.root && !workspace.loadError ? ' workspace-scroll--project-document' : ''}`} role="region" aria-label={`${title}内容`} tabIndex={0}>
        {activePage === 'dev-environment' ? <DevEnvironmentPanel model={environment} /> : activePage === 'servers-credentials' ? (serverManager.isPreview || (workspace.workspace?.root && !workspace.loadError) ? <ServerCredentialsPanel model={serverManager} route={route} /> : <WorkspaceGate model={workspace} />) : activePage === 'task-panel' ? <TaskPanel model={taskPanel} /> : activePage === 'bookkeeping' ? (workspace.workspace?.root && !workspace.loadError ? <BookkeepingPanel model={bookkeeping} create={route === 'bookkeeping/new'} editId={route.startsWith('bookkeeping/') && route !== 'bookkeeping/new' ? route.slice(12) : null} /> : <WorkspaceGate model={workspace} />) : activePage === 'today' ? (workspace.workspace?.root && !workspace.loadError ? <Today pi={pi} agentData={agentData} model={workspace} projects={projects} editorial={editorial} reader={reader} ideas={ideas} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'ideas' ? (workspace.workspace?.root && !workspace.loadError ? <IdeasPanel model={ideas} projects={projects.projects} projectsLoading={projects.loading} projectsError={projects.loadError} workspace={workspace} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'projects' ? (workspace.workspace?.root && !workspace.loadError ? target ? <ProjectEditor key={target.projectId} model={projects} projectId={target.projectId} targetRow={target.row} /> : <ProjectsOverview model={projects} create={route === 'projects/new'} /> : <WorkspaceGate model={workspace} />) : route === 'models' ? <ModelRankingPanel model={rankings} hasRoot={!!workspace.workspace?.root && !workspace.loadError} rootError={workspace.loadError} /> : route === 'agent' ? (workspace.workspace?.root && !workspace.loadError ? <AgentPanel model={pi} agentData={agentData} onDock={()=>{const destination=pi.source.page==='agent'?'today':pi.source.page;setAgentOpen(true);location.hash=destination;}} /> : <WorkspaceGate model={workspace} />) : route === 'resources' ? (workspace.workspace?.root && !workspace.loadError ? <PiResourcesPanel model={pi} /> : <WorkspaceGate model={workspace} />) : activePage === 'settings' ? <SettingsWorkspace route={route} sourceId={newsTarget} workspace={workspace} pi={pi} providers={providers} news={news} editorial={editorial} processing={processing} desktop={desktop} theme={theme} selectTheme={selectTheme} /> : activePage === 'news' ? (workspace.workspace?.root && !workspace.loadError ? route.startsWith('news/items/') ? <NewsArticlePage backHref={newsReturn.current} key={route} id={route.slice(11)} root={workspace.workspace.root} news={news} onBookmark={()=>void reader.refresh()} preview={document.documentElement.dataset.uiPreview==='true'?articlePreview:undefined} /> : route.startsWith('news/stories/') ? <NewsStoryPage id={route.slice(13)} model={reader} /> : route.startsWith('news/events/') ? <NewsArticlePage backHref={newsReturn.current} key={route} id={route.slice(12)} root={workspace.workspace.root} news={news} onBookmark={()=>void reader.refresh()} preview={document.documentElement.dataset.uiPreview==='true'?articlePreview:undefined} /> : route === 'news/daily' || route.startsWith('news/daily/') ? <NewsDailyPanel key={workspace.workspace.root} model={reader} editorial={editorial} news={news} editionId={route.startsWith('news/daily/')?route.slice(11):undefined}/> : <NewsReaderList model={reader} legacy={editorial} news={news} /> : <WorkspaceGate model={workspace} />) : route === 'jobs' ? (workspace.workspace?.root && !workspace.loadError ? <><AgentJobsPanel model={agentJobs}/><NewsProcessingPanel model={editorial} news={news} processing={processing} /></> : <WorkspaceGate model={workspace} />) : <Placeholder route={route} />}
        </div>
        </div>
      <AgentSidebar returnFocus={()=>agentEntry.current?.focus({preventScroll:true})} open={agentOpen&&route!=='agent'&&activePage!=='servers-credentials'} onClose={()=>setAgentOpen(false)} title={`Agent · ${title}`}><AgentChat model={pi} agentData={agentData} compact onClose={()=>setAgentOpen(false)} onExpand={()=>{setAgentOpen(false);location.hash='agent';}}/></AgentSidebar>
        </div>
      </main>
    </div>
  </>;
}
