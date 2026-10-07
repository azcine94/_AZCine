import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, listen } from './desktop-api.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { taskPanelClient, taskWorkspaceClient } from './task-panel-client.ts';
import type { TaskWorkspaceEntry } from './task-panel-client.ts';
import { useTaskPanelWorkflow } from './use-task-panel-workflow.ts';
import { newTaskDraft, nonEmptyLines, taskDraft, taskError } from './task-panel-contract.ts';
import type { GraphQuery, GraphView, PanelSnapshot, RepositoryDraft, TaskDraft, TaskMutation, TaskProject, TaskView } from './task-panel-contract.ts';

export function useTaskPanel(_businessRoot: string | null, enabled = true) {
  const [root, setRoot] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<TaskWorkspaceEntry[]>([]);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const workspaceRequest = useRef(0);
  const [snapshot, setSnapshot] = useState<PanelSnapshot | null>(null);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [action, setAction] = useState(''), [actionError, setActionError] = useState('');
  const [selectedId, select] = useState<string | null>(null), [tab, setTab] = useState('board');
  const [query, setQuery] = useState(''), [repositoryFilter, setRepositoryFilter] = useState(''), [branchFilter, setBranchFilter] = useState(''), [showDone, setShowDone] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [projectFilter, setProject] = useState('');
  const projectScope = useRef(projectFilter); projectScope.current = projectFilter;
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState(() => ({ id: crypto.randomUUID(), name: '', summary: '', repositoryIds: [] as string[], expectedRevision: null as number | null }));
  const projectDrafts = useRef<Record<string, typeof projectDraft>>({});
  const projectCurrent = useRef(projectDraft), projectSession = useRef(0); projectCurrent.current = projectDraft; projectDrafts.current[projectDraft.expectedRevision === null ? `${root}:new` : projectDraft.id] = projectDraft;
  const [editorOpen, setEditorOpen] = useState(false), [draft, setDraft] = useState<TaskDraft>(newTaskDraft);
  const drafts = useRef<Record<string, TaskDraft>>({});
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intake, setIntake] = useState<RepositoryDraft>(() => ({ id: crypto.randomUUID(), label: '', path: '', scope: '.', goal: '', skillPath: 'E:\\skills-manager\\archify', agentKind: 'codex', paneName: '', exchangePath: '', paneId: '', step: 1, projectId: '' }));
  const [graph, setGraph] = useState<GraphView | null>(null), [graphLoading, setGraphLoading] = useState(false), [graphError, setGraphError] = useState('');
  const [graphMode, setGraphMode] = useState<'architecture' | 'task'>('architecture');
  const [graphCenter, setGraphCenter] = useState<string | null>(null), [graphDepth, setGraphDepth] = useState(2), [graphFilter, setGraphFilter] = useState('all');
  const [selectedNode, selectNode] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState({ body: '', source: '', kind: 'decision', supersedes: '' });
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, typeof memoryDraft>>({});
  const [memoryEdits, setMemoryEdits] = useState<Record<string, {body: string; source: string; kind: string}>>({});
  const [memoryTarget, setMemoryTarget] = useState('');
  const [memoryFilter, setMemoryFilter] = useState('active');
  const [resumeDrafts, setResumeDrafts] = useState<Record<string, string>>({});
  const [semanticDrafts, setSemanticDrafts] = useState<Record<string, string>>({});
  const [relationDraft, setRelationDraft] = useState({ targetId: '', kind: 'depends_on', threshold: 'acceptance', source: '本人指定' });
  const identity = useRef({ root, generation: 0 });
  if (identity.current.root !== root) identity.current = { root, generation: identity.current.generation + 1 };
  const alive = useRef(true), busy = useRef(false), dialogSession = useRef(0), graphSession = useRef(0);
  const requests = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !root || !isTauri() || refreshing.current) return;
    refreshing.current = true;
    const generation = identity.current.generation;
    setLoading(true);
    try {
      const result = await taskPanelClient(root).list();
      if (alive.current && generation === identity.current.generation) { setSnapshot(result); setLoadError(''); }
    } catch (error) { if (alive.current && generation === identity.current.generation) setLoadError(taskError(error)); }
    finally { refreshing.current = false; if (alive.current && generation === identity.current.generation) setLoading(false); }
  }, [root, enabled]);
  useEffect(() => { setSnapshot(null); setLoadError(''); if (root) void refresh(); }, [root, refresh]);
  useEffect(() => {
    if (!root || !enabled || !isTauri()) return;
    let active = true;
    const unlisten = listen<string>('task-panel-changed', event => { if (active && event.payload === root) void refresh(); });
    const timer = setInterval(() => void refresh(), 5000);
    return () => { active = false; clearInterval(timer); void unlisten.then(stop => stop()); };
  }, [root, enabled, refresh]);
  const workflow = useTaskPanelWorkflow(root, refresh);
  async function mutate(action: TaskMutation, expectedRevision: number | null, label = '保存') {
    if (!enabled || busy.current || openingWorkspace) return null;
    busy.current = true; setAction(label); setActionError('');
    const generation = identity.current.generation;
    const fingerprint = JSON.stringify({ root, expectedRevision, action });
    const requestId = requests.current.get(fingerprint) ?? crypto.randomUUID();
    requests.current.set(fingerprint, requestId);
    try {
      const result = await taskPanelClient(root).mutate(requestId, expectedRevision, action);
      if (!alive.current || generation !== identity.current.generation) return null;
      requests.current.delete(fingerprint); await refresh(); notifyOperation(`${label}已完成`); return result;
    } catch (error) { if (alive.current && generation === identity.current.generation) setActionError(taskError(error)); return null; }
    finally { busy.current = false; if (alive.current) setAction(''); }
  }
  function openEditor(task?: TaskView) {
    drafts.current[draft.id] = draft;
    setDraft(task ? drafts.current[task.id] ?? taskDraft(task) : drafts.current[`${root}:new`] ?? { ...newTaskDraft(), projectId: projectFilter, repositoryId: repositoryFilter || snapshot?.repositories[0]?.id || '', scope: snapshot?.repositories[0]?.scope.join('\n') || '.' });
    ++dialogSession.current; setActionError(''); setEditorOpen(true);
  }
  function updateDraft(patch: Partial<TaskDraft>) { setDraft(before => { const next = { ...before, ...patch }; drafts.current[next.id] = next; if (next.expectedRevision === null) drafts.current[`${root}:new`] = next; return next; }); }
  function closeEditor(open: boolean) { ++dialogSession.current; setEditorOpen(open); }
  async function saveTask(start = false) {
    const submitted = { ...draft }, session = dialogSession.current, selectedProject = projectScope.current;
    if (submitted.newBranch?.trim() && submitted.expectedRevision === null) {
      const fingerprint = JSON.stringify({ root, task: submitted.id, branch: submitted.newBranch });
      const requestId = requests.current.get(fingerprint) ?? crypto.randomUUID(); requests.current.set(fingerprint, requestId);
      try {
        const target = taskPanelClient(root);
        const saved = await workflow.perform('保存任务并创建分支', async () => {
          const result = await target.mutate(`${requestId}-task`, null, { type:'save_task', id:submitted.id, title:submitted.title, goal:submitted.goal, scope:nonEmptyLines(submitted.scope), criteria:nonEmptyLines(submitted.criteria), repositoryId:submitted.repositoryId || null, source:submitted.source, plan:{ projectId:submitted.projectId || null, goalId:submitted.goalId || null, phase:submitted.phase } });
          const created = await target.input<{path:string;error:string}>('worktree', { requestId, taskId:submitted.id, branch:submitted.newBranch!.trim(), label:submitted.paneName || submitted.title, approved:true });
          return {result,created};
        });
        if (!saved) return null;
        const {result,created}=saved;
        if (created.error) { setActionError(created.error); await refresh(); return null; }
        await refresh();
        if(identity.current.root!==root) return result;
        select(submitted.id); setTab('board'); setBranchFilter('');
        const edited=drafts.current[submitted.id];
        const sameDraft=!edited || JSON.stringify(edited)===JSON.stringify(submitted);
        if(sameDraft){
          delete drafts.current[submitted.id];
          if(drafts.current[`${root}:new`]?.id===submitted.id) delete drafts.current[`${root}:new`];
          if(session===dialogSession.current){closeEditor(false);setDraft(newTaskDraft());}
        }else if(edited){
          const next={...edited,expectedRevision:result.revision,newBranch:''};
          drafts.current[submitted.id]=next;
          if(session===dialogSession.current)setDraft(next);
        }
        if (start) await workflow.perform('在任务分支开始', () => target.input('launch', { requestId:`${requestId}-launch`, taskId:submitted.id, expectedRevision:result.revision, kind:submitted.agentKind || 'codex', paneName:submitted.paneName || submitted.title, allowedActions:['read_scoped_files','edit_task_files','write_delivery_artifacts'], approved:true }));
        return result;
      } catch (error) { setActionError(taskError(error)); return null; }
    }
    const result = await mutate({ type: 'save_task', id: submitted.id, title: submitted.title, goal: submitted.goal, scope: nonEmptyLines(submitted.scope), criteria: nonEmptyLines(submitted.criteria), repositoryId: submitted.repositoryId || null, source: submitted.source, plan: { projectId: submitted.projectId || null, goalId: submitted.goalId || null, phase: submitted.phase } }, submitted.expectedRevision, '保存任务');
    if (result) {
      const edited = drafts.current[submitted.id];
      const sameDraft = !edited || JSON.stringify(edited) === JSON.stringify(submitted);
      if (sameDraft) { delete drafts.current[submitted.id]; if (drafts.current[`${root}:new`]?.id === submitted.id) delete drafts.current[`${root}:new`]; }
      if (projectScope.current === selectedProject) { if (selectedProject && submitted.projectId !== selectedProject) setProjectFilter(submitted.projectId); select(submitted.id); }
      if (session === dialogSession.current && sameDraft) { closeEditor(false); setDraft(newTaskDraft()); }
      else if (edited) { const next = { ...edited, expectedRevision: result.revision }; drafts.current[submitted.id] = next; if (drafts.current[`${root}:new`]?.id === submitted.id) delete drafts.current[`${root}:new`]; if (session === dialogSession.current) setDraft(next); }
    }
    if (result && start) {
      const current = await workflow.perform('读取已保存任务', taskPanelClient(root).list);
      const task = current?.tasks.find(t => t.id === submitted.id);
      if (task) {
        workflow.openDispatch(task);
        workflow.setDispatchDraft(d => ({ ...d, kind: submitted.agentKind || 'codex', paneName: submitted.paneName || submitted.title, approved: false }));
        await workflow.launch(task, submitted.agentKind || 'codex', submitted.paneName || submitted.title);
      }
    }
    return result;
  }
  async function openWorkspace(path: string, label = '', scope = ['.'], configure = false) {
    if (!enabled) return null;
    if (busy.current || workflow.action) { setActionError('请等待当前保存或派发完成后切换仓库。'); return null; }
    const request = ++workspaceRequest.current; setOpeningWorkspace(true); setActionError('');
    try {
      const opened = await taskWorkspaceClient.open(path, label, scope, configure);
      if (!alive.current || request !== workspaceRequest.current) return null;
      drafts.current[draft.id] = draft;
      setDraft(newTaskDraft()); setProjectDraft({ id: crypto.randomUUID(), name: '', summary: '', repositoryIds: [], expectedRevision: null });
      setRoot(opened.path); setBranchFilter(''); setProject(opened.projectId || ''); setRepositoryFilter(opened.repositoryId);
      select(null); selectNode(null); setGraph(null); setGraphCenter(null); setMemoryTarget(''); setEditorOpen(false); setProjectOpen(false);
      if (opened.path === root) await refresh();
      setWorkspaces(await taskWorkspaceClient.list());
      try { localStorage.setItem('azcine.task-panel.workspace', opened.path); } catch { /* UI preference only */ }
      if (opened.migration) notifyOperation(opened.migration, { tone: 'info' });
      return opened;
    } catch (error) { if (alive.current && request === workspaceRequest.current) setActionError(taskError(error)); return null; }
    finally { if (alive.current && request === workspaceRequest.current) setOpeningWorkspace(false); }
  }
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let active = true;
    void taskWorkspaceClient.list().then(entries => {
      if (!active) return; setWorkspaces(entries);
      let last: string | null = null; try { last = localStorage.getItem('azcine.task-panel.workspace'); } catch { /* optional */ }
      const selected = entries.find(e => e.path === last) ?? (last ? {path:last,label:''} : entries[0]);
      if (selected && workspaceRequest.current === 0) void openWorkspace(selected.path, selected.label);
    }).catch(error => { if (active) setActionError(taskError(error)); });
    return () => { active = false; };
  }, []);
  async function saveRepository() {
    const submitted = { ...intake };
    const opened = await openWorkspace(submitted.path, submitted.label, nonEmptyLines(submitted.scope), true);
    if (opened) setIntake(before => before.id === submitted.id ? { ...before, id: opened.repositoryId, path: opened.path, label: opened.label, scope: opened.scope.join('\n'), projectId: opened.projectId || '', skillPath: before.skillPath || opened.skillPath, paneName: before.paneName || `${opened.label} · 建图`, step: 2 } : before);
    return opened;
  }
  async function loadGraph(input: GraphQuery, append = false) {
    const session = ++graphSession.current, generation = identity.current.generation;
    setGraphLoading(true); setGraphError('');
    try {
      const result = await taskPanelClient(root).graph(input);
      if (!alive.current || session !== graphSession.current || generation !== identity.current.generation) return;
      setGraph(before => append && before?.graphRevision === result.graphRevision ? { ...result, nodes: [...new Map([...before.nodes, ...result.nodes].map(n => [n.id, n])).values()], relations: result.relations } : result);
    } catch (error) { if (alive.current && session === graphSession.current) setGraphError(taskError(error)); }
    finally { if (alive.current && session === graphSession.current) setGraphLoading(false); }
  }
  function setProjectFilter(id: string) {
    setProject(id); setRepositoryFilter(''); select(null); selectNode(null); setGraphCenter(null); setGraph(null); setGraphLoading(false); setMemoryTarget(''); ++graphSession.current;
  }
  function openProject(project?: TaskProject) {
    if (project) setProjectDraft(projectDrafts.current[project.id] ?? { id: project.id, name: project.name, summary: project.summary, repositoryIds: project.repositoryIds, expectedRevision: project.revision });
    else setProjectDraft(projectDrafts.current[`${root}:new`] ?? { id: crypto.randomUUID(), name: '', summary: '', repositoryIds: [], expectedRevision: null });
    ++projectSession.current; setActionError(''); setProjectOpen(true);
  }
  function closeProject(open: boolean) { ++projectSession.current; setProjectOpen(open); }
  async function saveProject() {
    const submitted = { ...projectDraft }, session = projectSession.current;
    const result = await mutate({ type: 'project', id: submitted.id, name: submitted.name, summary: submitted.summary, repositoryIds: submitted.repositoryIds }, submitted.expectedRevision, '保存项目');
    if (result) {
      const current = projectDrafts.current[submitted.expectedRevision === null ? `${root}:new` : submitted.id];
      const unchanged = JSON.stringify(current) === JSON.stringify(submitted);
      if (submitted.expectedRevision === null && current?.id === submitted.id) delete projectDrafts.current[`${root}:new`];
      const next = { ...(current?.id === submitted.id ? current : submitted), expectedRevision: result.revision };
      projectDrafts.current[submitted.id] = next;
      if (session === projectSession.current) { setProjectDraft(next); if (unchanged) { closeProject(false); setProjectFilter(result.objectId); } }
    }
    return result;
  }
  return { root, workspaces, openingWorkspace, openWorkspace, snapshot, loading, loadError, refresh, action, actionError, setActionError, mutate, selectedId, select, tab, setTab, query, setQuery, repositoryFilter, setRepositoryFilter, branchFilter, setBranchFilter, showDone, setShowDone, showCancelled, setShowCancelled,
    editorOpen, closeEditor, draft, updateDraft, openEditor, saveTask, intakeOpen, setIntakeOpen, intake, setIntake, saveRepository, graph, graphLoading, graphError, graphMode, setGraphMode, loadGraph,
    selectedNode, selectNode, graphCenter, setGraphCenter, graphDepth, setGraphDepth, graphFilter, setGraphFilter, memoryDraft, setMemoryDraft, memoryDrafts, setMemoryDrafts, memoryEdits, setMemoryEdits, memoryTarget, setMemoryTarget, memoryFilter, setMemoryFilter,
    projectFilter, setProjectFilter, projectOpen, projectDraft, setProjectDraft, openProject, closeProject, saveProject,
    resumeDrafts, setResumeDrafts, semanticDrafts, setSemanticDrafts, relationDraft, setRelationDraft, workflow };
}
export type TaskPanelController = ReturnType<typeof useTaskPanel>;
