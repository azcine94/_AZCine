import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { pages, pageTitle, resolveRoute, projectTarget, navigationPage, sourceTarget } from './routes.ts';
import type { PageId, Route } from './routes.ts';
import { useTheme } from './use-theme.ts';
import { useDesktopCheck } from './use-desktop-check.ts';
import type { CheckState } from './desktop-contract.ts';
import logo from './assets/logo-lockup.png';
import { useWorkspace } from './use-workspace.ts';
import type { WorkspaceController } from './use-workspace.ts';
import { WorkspaceGate, DataSettings, TodoPanel } from './workspace-panels.tsx';
import { useProjects } from './use-projects.ts';
import type { ProjectsController } from './use-projects.ts';
import { ProjectsOverview, ProjectEditor, DeliveryList } from './projects-panels.tsx';
import { deriveDeliveries } from './projects-contract.ts';
import { usePi } from './use-pi.ts';
import { AgentPanel, PiSettings } from './pi-panels.tsx';
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
  return <div className="foundation-empty"><h2>{title}</h2><p>{children}</p></div>;
}
function Today({ model, projects, ideas, targetId }: { model: WorkspaceController; projects: ProjectsController; ideas: IdeasController; targetId: string | null }) {
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
        <header className="card-heading"><h2>接下来交付</h2><a className="foundation-link" href="#projects">查看项目</a></header>
        {<>{projects.loadError && <p className="form-error" role="alert">{projects.loadError}</p>}{projects.loading && <p className="meta" role="status">正在读取交付…</p>}{next && <div className="home-due-feature"><time dateTime={next.dueDate} aria-label={next.dueDate}><span className="meta">{next.dueDate.slice(0, 4)} 年</span><strong>{next.dueDate.slice(5).replace('-', '/')}</strong></time><div><span className="meta">最近交付</span><strong>{deliveries.filter(item => item.dueDate === next.dueDate).length} 项待交</strong></div></div>}<DeliveryList projects={projects.projects} compact /></>}
      </section>
      <section className="today-card today-news-card">
        <header className="card-heading"><h2>今日资讯</h2><a className="foundation-link" href="#news">查看资讯</a></header>
        <Empty title="暂无资讯刊期">真实采集接入后显示，不用示例新闻占位。</Empty>
      </section>
    </div>
    <div className="foundation-job"><span>后台队列未接入</span><a href="#jobs">查看后台任务</a></div>
  </>;
}
function Placeholder({ route }: { route: Route }) {
  switch (route) {
    case 'news': return <Empty title="还没有资讯刊期">资讯采集与整理将在 S07 接入，这里不会填充示例新闻。</Empty>;
    case 'models': return <Empty title="还没有模型榜快照">Arena Text Overall 前 30 名将在 S09 接入，不显示虚构排名。</Empty>;
    case 'jobs': return <Empty title="后台队列尚未接入">本阶段没有运行中的业务任务。关闭桌面窗口即退出，暂不收托盘。</Empty>;
    default: return <Empty title="没有这个页面">请从左侧导航打开页面。</Empty>;
  }
}
function CheckResult({ state }: { state: CheckState }) {
  switch (state.status) {
    case 'idle': return <><h3>还未检查</h3><p>调用 Rust 验证独立临时数据库，不接触业务记录。</p></>;
    case 'loading': return <><h3>正在检查桌面连接</h3><p>等待 Rust 和临时数据库响应，请稍候。</p></>;
    case 'error': return <><h3>连接检查失败</h3><p>{state.message}</p></>;
    case 'success': return <><h3>桌面连接正常</h3><p>Rust 往返、临时库写入 / 读取和事务回滚均已通过；检查文件按本轮要求保留。</p><p className="meta">SQLite {state.report.sqliteVersion} · 开发版本 {state.report.appVersion} · 请求 {state.report.requestId}</p></>;
  }
}

export default function App() {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const title = pageTitle(route);
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const { theme, toggle, warning } = useTheme();
  const { state, check, connected } = useDesktopCheck();
  const workspace = useWorkspace();
  const projects = useProjects(workspace.workspace?.root ?? null);
  const pi = usePi(workspace.workspace?.root ?? null);
  const ideas = useIdeas(workspace.workspace?.root ?? null);
  const target = projectTarget(route);
  const activePage = navigationPage(route);
  const sourceId = sourceTarget(route);
  useEffect(() => {
    if (activePage === 'today' && sourceId) {
      const todo = workspace.workspace?.todos.find(t => t.id === sourceId);
      if (todo) workspace.setFilter(todo.completed ? 'completed' : 'incomplete');
    }
  }, [activePage, sourceId, workspace.workspace?.todos]);
  useLayoutEffect(() => {
    document.title = `AZCine · ${title}`;
    heading.current?.focus({ preventScroll: true });
    scrollArea.current?.scrollTo(0, 0);
  }, [route, title]);
  return <>
    <header className="titlebar"><span className="preview-title">AZCine · {connected ? '本地开发版' : '网页预览 · 无桌面连接'}</span><button className="theme-button" onClick={toggle} aria-pressed={theme === 'dark'}>{theme === 'dark' ? '切换浅色' : '切换深色'}</button></header>
    {warning && <p className="theme-warning" role="status">{warning}</p>}
    <div className="app-shell">
      <aside className="side">
        <a className="brand" href="#today" aria-label="AZCine 今天"><img className="brand-lockup" src={logo} alt="AZCine" /></a>
        <nav aria-label="主导航">{pages.map(page => <a key={page.id} className="nav-item" href={`#${page.id}`} aria-current={activePage === page.id ? 'page' : undefined}><Icon name={page.icon} /><span>{page.title}</span></a>)}</nav>
      </aside>
      <main className="workspace" data-page={route}>
        <header className="page-heading"><div className="page-name"><h1 tabIndex={-1} ref={heading}>{title}</h1></div><span className="meta">{activePage === 'projects' ? '文档与交付' : activePage === 'ideas' ? '想法先留下，不必立刻变成任务' : '本地工作台'}</span></header>
        <div ref={scrollArea} className={`workspace-scroll${target && projects.drafts[target.projectId] && workspace.workspace?.root && !workspace.loadError ? ' workspace-scroll--project-document' : ''}`} role="region" aria-label={`${title}内容`} tabIndex={0}>
        {activePage === 'today' ? (workspace.workspace?.root && !workspace.loadError ? <Today model={workspace} projects={projects} ideas={ideas} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'ideas' ? (workspace.workspace?.root && !workspace.loadError ? <IdeasPanel model={ideas} projects={projects.projects} projectsLoading={projects.loading} projectsError={projects.loadError} workspace={workspace} targetId={sourceId} /> : <WorkspaceGate model={workspace} />) : activePage === 'projects' ? (workspace.workspace?.root && !workspace.loadError ? target ? <ProjectEditor key={target.projectId} model={projects} projectId={target.projectId} targetRow={target.row} /> : <ProjectsOverview model={projects} create={route === 'projects/new'} /> : <WorkspaceGate model={workspace} />) : route === 'agent' ? (workspace.workspace?.root && !workspace.loadError ? <AgentPanel model={pi} /> : <WorkspaceGate model={workspace} />) : route === 'settings' ? <><DataSettings model={workspace} /><PiSettings model={pi} /><section className="foundation-section">
          <h2>桌面连接检查</h2><p className="subtle">独立检查 Rust 与测试库，不修改待办记录；检查产物保留。</p>
          <div className="foundation-check" data-check-state={state.status} role="status" aria-live="polite" aria-busy={state.status === 'loading'}><CheckResult state={state} /></div>
          <div className="check-actions"><button className="pill on" onClick={() => void check()} disabled={!connected || state.status === 'loading'}>检查桌面连接</button>{!connected && <p className="subtle">网页预览不能执行检查，请从项目根运行 npm run dev。</p>}</div>
        </section></> : <Placeholder route={route} />}
        </div>
      </main>
    </div>
  </>;
}
