import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri, listen } from './desktop-api.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { taskPanelClient, taskWorkspaceClient } from './task-panel-client.ts';
import type { TaskWorkspaceEntry } from './task-panel-client.ts';
import { useTaskPanelWorkflow } from './use-task-panel-workflow.ts';
import { useTaskRefinement } from './use-task-refinement.ts';
import { useTaskPanelDrafts } from './use-task-panel-drafts.ts';
import { activePanelSnapshot, newTaskDraft, nonEmptyLines, taskDraft, taskError } from './task-panel-contract.ts';
import type { GraphQuery, GraphView, PanelSnapshot, RepositoryDraft, TaskDraft, TaskFeedback, TaskMutation, TaskProject, TaskView } from './task-panel-contract.ts';

export function useTaskPanel(_businessRoot: string | null, enabled = true) {
  const [root, setRoot] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<TaskWorkspaceEntry[]>([]);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const workspaceRequest = useRef(0);
  const [allSnapshot, setSnapshot] = useState<PanelSnapshot | null>(null);
  const snapshot = useMemo(() => activePanelSnapshot(allSnapshot), [allSnapshot]);
  const projectCatalog = allSnapshot?.projects ?? [];
  const projectTaskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of allSnapshot?.tasks ?? []) if (task.plan.projectId && task.objectKind !== 'goal') counts[task.plan.projectId] = (counts[task.plan.projectId] ?? 0) + 1;
    return counts;
  }, [allSnapshot]);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [action, setAction] = useState(''), [actionError, setActionError] = useState('');
  const [selectedId, select] = useState<string | null>(null), [tab, setTab] = useState('board');
  const [query, setQuery] = useState(''), [repositoryFilter, setRepositoryFilter] = useState(''), [branchFilter, setBranchFilter] = useState(''), [showDone, setShowDone] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [projectFilter, setProject] = useState('');
  const projectScope = useRef(projectFilter); projectScope.current = projectFilter;
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState(() => ({ id: crypto.randomUUID(), name: '', summary: '', repositoryIds: [] as string[], expectedRevision: null as number | null }));
  const projectDrafts = useRef<Record<string, typeof projectDraft>>({});
  const projectCurrent = useRef(projectDraft), projectSession = useRef(0); projectCurrent.current = projectDraft; projectDrafts.current[projectDraft.expectedRevision === null ? `${root}:new` : projectDraft.id] = projectDraft;
  const [editorOpen, setEditorOpen] = useState(false), [draft, setDraft] = useState<TaskDraft>(newTaskDraft);
  const currentDraft = useRef(draft); currentDraft.current = draft;
  function setEditorDraft(value:TaskDraft) {currentDraft.current=value;setDraft(value);}
  const draftStorage = useTaskPanelDrafts(enabled), drafts = draftStorage.drafts;
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intake, setIntake] = useState<RepositoryDraft>(() => ({ id: crypto.randomUUID(), label: '', path: '', scope: '.', goal: '', skillPath: 'E:\\skills-manager\\archify', agentKind: 'codex', paneName: '', exchangePath: '', paneId: '', step: 1, projectId: '' }));
  const [graph, setGraph] = useState<GraphView | null>(null), [graphLoading, setGraphLoading] = useState(false), [graphError, setGraphError] = useState('');
  const [graphMode, setGraphMode] = useState<'architecture' | 'task'>('task');
  const [graphLayer, setGraphLayer] = useState<GraphQuery['layer']>(undefined);
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
  const graphScope = useRef({ key:'', count:80 });
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
  const [, setFeedbackVersion] = useState(0);
  const [feedbackFailure, setFeedbackFailure] = useState({root:'',taskId:'',message:''});
  function setFeedbackError(message:string,taskId=selectedId || '',workspace=root || '') {setFeedbackFailure({root:workspace,taskId,message});}
  const feedbackError=feedbackFailure.root===root&&feedbackFailure.taskId===selectedId?feedbackFailure.message:'';
  const feedbackBusy = useRef(false);
  const feedbackRequests = useRef(new Map<string,{id:string;requestId:string}>());
  function feedbackText(task:TaskView) { return drafts.current[draftStorage.key(root,`feedback-draft-${task.id}`)]?.feedbackText || ''; }
  function updateFeedback(task:TaskView, body:string) {
    const value = { ...taskDraft(task), id:`feedback-draft-${task.id}`, feedbackOnly:true, feedbackText:body };
    draftStorage.remember(root,value); setFeedbackVersion(v=>v+1); setFeedbackError('');
  }
  async function sendFeedback(task:TaskView, executionId:string) {
    if (!enabled || !root || feedbackBusy.current || workflow.action) return;
    const workspace=root, generation=identity.current.generation, body=feedbackText(task).trim();
    const key=JSON.stringify({workspace,taskId:task.id,revision:task.revision,executionId,body});
    const request=feedbackRequests.current.get(key) ?? {id:crypto.randomUUID(),requestId:crypto.randomUUID()}; feedbackRequests.current.set(key,request);
    feedbackBusy.current=true; setFeedbackError('');
    try {
      const target=taskPanelClient(workspace);
      const saved=await target.input<TaskFeedback>('feedback',{requestId:request.requestId,id:request.id,taskId:task.id,expectedRevision:task.revision,executionId,body,action:'save',approved:true});
      if (!alive.current || generation!==identity.current.generation) return;
      feedbackRequests.current.delete(key);
      if (feedbackText(task).trim()===body) {draftStorage.forget(workspace,`feedback-draft-${task.id}`);setFeedbackVersion(v=>v+1);}
      await target.input('feedback',{requestId:`${request.requestId}-send`,id:saved.id,taskId:task.id,expectedRevision:task.revision,executionId,action:'send',approved:true});
      await refresh();
    } catch(e) {if(generation===identity.current.generation){setFeedbackError(taskError(e),task.id,workspace);await refresh();}}
    finally {feedbackBusy.current=false;}
  }
  async function cancelFeedback(task:TaskView,executionId:string,id:string) {
    if(!enabled || !root || feedbackBusy.current) return;
    const workspace=root,generation=identity.current.generation; feedbackBusy.current=true;
    try {await taskPanelClient(workspace).input('feedback',{requestId:crypto.randomUUID(),taskId:task.id,expectedRevision:task.revision,executionId,id,action:'cancel',approved:true});await refresh();}
    catch(e){if(alive.current&&generation===identity.current.generation)setFeedbackError(taskError(e),task.id,workspace);}
    finally{feedbackBusy.current=false;}
  }
  // A saved opinion authorizes one notification to the exact original pane.
  // Wait for a usable prompt rather than injecting text into a running tool.
  useEffect(()=>{
    if (!enabled || !root || feedbackBusy.current || !isTauri()) return;
    const pending=snapshot?.feedback?.find(f=>f.state==='pending'&&snapshot.tasks.some(t=>t.id===f.taskId&&t.revision===f.taskRevision&&t.lifecycle==='active')&&snapshot.executions.some(r=>r.id===f.executionId&&r.taskRevision===f.taskRevision&&['awaiting_receipt','accepted','running','blocked'].includes(r.state))&&snapshot.monitor?.runs[f.executionId]&&['idle','done'].includes(snapshot.monitor.runs[f.executionId].state));
    if (!pending) return;
    const workspace=root, generation=identity.current.generation; feedbackBusy.current=true;
    void taskPanelClient(workspace).input('feedback',{requestId:`feedback-send-${pending.id}`,id:pending.id,taskId:pending.taskId,expectedRevision:pending.taskRevision,executionId:pending.executionId,action:'send',approved:true})
      .catch(e=>{if(alive.current&&generation===identity.current.generation)setFeedbackError(taskError(e),pending.taskId,workspace);})
      .finally(()=>{feedbackBusy.current=false;});
  },[snapshot,root,enabled]);
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
    const repository = snapshot?.repositories.find(item => repositoryFilter ? item.id === repositoryFilter : projectFilter ? snapshot?.projects.find(project => project.id === projectFilter)?.repositoryIds.includes(item.id) : true);
    const projectId = projectFilter || snapshot?.projects.find(item => item.repositoryIds.includes(repository?.id ?? ''))?.id || '';
    setEditorDraft(task ? drafts.current[draftStorage.key(root, task.id)] ?? taskDraft(task) : drafts.current[draftStorage.key(root, 'new')] ?? { ...newTaskDraft(), projectId, repositoryId: repository?.id ?? '', scope: repository?.scope.join('\n') || '.' });
    ++dialogSession.current; setActionError(''); setEditorOpen(true);
  }
  function updateDraft(patch: Partial<TaskDraft>) { const next = { ...currentDraft.current, ...patch }; currentDraft.current = next; draftStorage.remember(root, next); setEditorDraft(next); }
  const refinement = useTaskRefinement(_businessRoot, root, draft, snapshot, updateDraft, enabled && editorOpen && draft.expectedRevision === null);
  function closeEditor(open: boolean) { ++dialogSession.current; setEditorOpen(open); }
  async function saveTask(start = false, createBranch = true) {
    if (busy.current || workflow.action || openingWorkspace || !root) return null;
    const workspace = root, generation = identity.current.generation;
    const submitted = { ...draft }, session = dialogSession.current;
    const saveBaseline = JSON.stringify(submitted);
    const selectedProject = projectScope.current;
    if (submitted.expectedRevision === null && submitted.rawRequest?.trim()) {
      if (refinement.busy || submitted.refinementQuestions?.length || !submitted.manualTask && submitted.refinedRequest && (submitted.refinedRequest !== submitted.rawRequest.trim() || submitted.refinedRepositoryId !== submitted.repositoryId)) {
        setActionError('请先完成细化并核对当前需求的草案。'); return null;
      }
      submitted.goal = `${submitted.goal}\n\n## 原始需求\n${submitted.rawRequest.trim()}`;
      if (submitted.goal.length > 20000) { setActionError('任务说明与原始需求合计超过 20000 字，请精简后保存。'); return null; }
    }
    const result = await mutate({ type: 'save_task', id: submitted.id, title: submitted.title, goal: submitted.goal,
      scope: nonEmptyLines(submitted.scope), criteria: nonEmptyLines(submitted.criteria), repositoryId: submitted.repositoryId || null,
      source: submitted.source, plan: { projectId: submitted.projectId || null, goalId: submitted.goalId || null, phase: submitted.phase } }, submitted.expectedRevision, '保存任务');
    if (!result || identity.current.generation !== generation) return result;
    const currentKey = draftStorage.key(workspace, submitted.id);
    const edited = drafts.current[currentKey] ?? submitted;
    const unchanged = JSON.stringify(edited) === saveBaseline;
    // The task is already durable, even if the next external step fails. A
    // retry must update this task rather than repeat its creation request.
    const next = { ...(unchanged ? submitted : edited), expectedRevision: result.revision, worktreePending:!!submitted.newBranch?.trim() };
    draftStorage.remember(workspace, next);
    if (session === dialogSession.current) setEditorDraft(next);
    setTab('board');
    if (projectScope.current === selectedProject && selectedProject && submitted.projectId !== selectedProject) setProjectFilter(submitted.projectId);
    select(submitted.id);
    if (submitted.newBranch?.trim()) {
      if (createBranch) {
        const assigned = snapshot?.tasks.find(task => task.id === submitted.id)?.executionWorkspace;
        const created = assigned && assigned.branch === submitted.newBranch.trim() ? {path:assigned.path,error:''} : await workflow.input<{ path:string; error:string }>('worktree', '创建任务分支', {
          taskId: submitted.id, branch: submitted.newBranch.trim(), label: submitted.paneName || submitted.title, approved:true,
        });
        if (!created || created.error) {
          if (identity.current.generation === generation) { setActionError(`任务已保存，分支未创建。${created?.error || workflow.error || '请核对原位置后重试。'}`); await refresh(); }
          return result;
        }
      } else {
        const kept = await mutate({ type:'keep_task_without_worktree', id:submitted.id, approved:true }, result.revision, '仅保留任务');
        if (!kept) return result;
      }
      if (identity.current.generation !== generation) return result;
      const latest = drafts.current[currentKey] ?? next;
      const recovered = { ...latest, newBranch:'', worktreePending:false };
      draftStorage.remember(workspace, recovered);
      if (session === dialogSession.current) setEditorDraft(recovered);
    }
    if (identity.current.generation !== generation) return result;
    const latest = drafts.current[currentKey];
    const savedInput = { ...next, newBranch:submitted.newBranch?.trim() ? '' : next.newBranch, worktreePending:false };
    const sameInput = unchanged && JSON.stringify(latest) === JSON.stringify(savedInput);
    // Clear only the exact input saved by this session, including execution settings.
    if (sameInput) {
      draftStorage.forget(workspace, submitted.id);
      if (session === dialogSession.current) { closeEditor(false); setEditorDraft(newTaskDraft()); }
    }
    if (start && createBranch) {
      const current = await workflow.perform('读取已保存任务', taskPanelClient(workspace).list);
      const task = current?.tasks.find(t => t.id === submitted.id);
      if (task && identity.current.generation === generation) await workflow.launch(task, submitted.agentKind || 'codex', submitted.paneName || submitted.title);
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
      await draftStorage.load(opened.path);
      if (!alive.current || request !== workspaceRequest.current) return null;
      setEditorDraft(newTaskDraft()); setProjectDraft({ id: crypto.randomUUID(), name: '', summary: '', repositoryIds: [], expectedRevision: null });
      setRoot(opened.path); setBranchFilter(''); setProject(opened.projectId || ''); setRepositoryFilter(opened.repositoryId);
      select(null); selectNode(null); setGraph(null); setGraphCenter(null); setMemoryTarget(''); setEditorOpen(false); setProjectOpen(false); setProjectManagerOpen(false);
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
    const scopeKey = JSON.stringify({ root, ...input, offset:0, limit:0 });
    if (graphScope.current.key !== scopeKey) graphScope.current = { key:scopeKey, count:input.limit || 80 };
    const end = append ? (input.offset || 0) + (input.limit || 80) : graphScope.current.count;
    setGraphLoading(true); setGraphError('');
    try {
      // Re-read the loaded range on sync. Page size stays bounded, but a
      // changed graph revision cannot retract the pages the user opened.
      let offset = 0, result:GraphView | null = null;
      const nodes = new Map<string, GraphView['nodes'][number]>(), relations = new Map<string, GraphView['relations'][number]>();
      do {
        const page = await taskPanelClient(root).graph({ ...input, offset, limit:Math.min(80, Math.max(1,end-offset)) });
        if (!alive.current || session !== graphSession.current || generation !== identity.current.generation) return;
        if (result && page.graphRevision !== result.graphRevision) throw new Error('关系正在变化，保留已加载内容并等待下次同步。');
        result = page; page.nodes.forEach(node => nodes.set(node.id,node)); page.relations.forEach(edge => relations.set(edge.id,edge));
        offset += page.nodes.length;
      } while (result.hasMore && result.nodes.length && offset < end);
      if (!result) return;
      if (!alive.current || session !== graphSession.current || generation !== identity.current.generation) return;
      graphScope.current.count = Math.max(end,nodes.size);
      setGraph({ ...result, nodes:[...nodes.values()], relations:[...relations.values()] });
      setGraphLayer(input.layer);
    } catch (error) { if (alive.current && session === graphSession.current && generation === identity.current.generation) setGraphError(taskError(error)); }
    finally { if (alive.current && session === graphSession.current && generation === identity.current.generation) setGraphLoading(false); }
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
  async function setProjectDeleted(project: TaskProject, deleted: boolean) {
    const result = await mutate({ type: 'project_deleted', id: project.id, deleted, approved: true }, project.revision, deleted ? '删除项目' : '恢复项目');
    if (!result) return null;
    const cached = projectDrafts.current[project.id];
    if (cached) projectDrafts.current[project.id] = { ...cached, expectedRevision: result.revision };
    setProjectDraft(before => before.id === project.id ? { ...before, expectedRevision: result.revision } : before);
    if (deleted) { selectNode(null); setGraph(null); setGraphCenter(null); setGraphLoading(false); ++graphSession.current; }
    if (deleted && projectScope.current === project.id) setProjectFilter('');
    if (deleted && projectCurrent.current.id === project.id) closeProject(false);
    return result;
  }
  useEffect(() => {
    const deleted = allSnapshot?.projects.filter(project => project.deleted) ?? [];
    if (deleted.some(project => project.id === projectFilter)) setProjectFilter('');
    if (deleted.some(project => project.repositoryIds.includes(repositoryFilter))) setRepositoryFilter('');
    const selectedProject = allSnapshot?.tasks.find(task => task.id === selectedId)?.plan.projectId;
    if (selectedProject && deleted.some(project => project.id === selectedProject)) select(null);
  }, [allSnapshot, projectFilter, repositoryFilter, selectedId]);
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
  return { isPreview:false, root, workspaces, openingWorkspace, openWorkspace, snapshot, loading, loadError, refresh, action, actionError, setActionError, mutate, selectedId, select, tab, setTab, query, setQuery, repositoryFilter, setRepositoryFilter, branchFilter, setBranchFilter, showDone, setShowDone, showCancelled, setShowCancelled,
    editorOpen, closeEditor, draft, updateDraft, openEditor, saveTask, refinement, feedbackText, updateFeedback, sendFeedback, cancelFeedback, feedbackError, setFeedbackError, draftStorageError:draftStorage.error, draftSaving:draftStorage.saving, intakeOpen, setIntakeOpen, intake, setIntake, saveRepository, graph, graphLayer, graphLoading, graphError, graphMode, setGraphMode, loadGraph,
    selectedNode, selectNode, graphCenter, setGraphCenter, graphDepth, setGraphDepth, graphFilter, setGraphFilter, memoryDraft, setMemoryDraft, memoryDrafts, setMemoryDrafts, memoryEdits, setMemoryEdits, memoryTarget, setMemoryTarget, memoryFilter, setMemoryFilter,
    projectFilter, setProjectFilter, projectOpen, projectDraft, setProjectDraft, openProject, closeProject, saveProject, projectCatalog, projectTaskCounts, projectManagerOpen, setProjectManagerOpen, setProjectDeleted,
    resumeDrafts, setResumeDrafts, semanticDrafts, setSemanticDrafts, relationDraft, setRelationDraft, workflow };
}
export type TaskPanelController = ReturnType<typeof useTaskPanel>;
