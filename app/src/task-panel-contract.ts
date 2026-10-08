export type Lane = 'human' | 'blocked' | 'ready' | 'running' | 'verify' | 'done';
export type EvidenceLevel = 'claim' | 'observed' | 'user_confirmed' | 'fixture' | 'stale';
export const laneLabels: Record<Lane, string> = { human: '需要关注', blocked: '受阻', ready: '可执行', running: '执行与等待', verify: '待验证', done: '已验收' };
export const lanes: Lane[] = ['human', 'blocked', 'ready', 'running', 'verify', 'done'];
export const reasonLabels: Record<string, string> = {
  workspace_unavailable: '执行目录不可用 · 请核对原位置',
  worktree_pending: '分支创建待核对 · 暂不派发', missing_workspace: '关联真实工作区', missing_goal: '补充任务目标', missing_scope: '明确操作范围', missing_criteria: '填写完成条件', draft: '任务草案待核对', paused: '任务已暂停', cancelled: '任务已取消',
  prerequisites: '前置尚未满足', workspace_busy: '同一工作区有执行未结束', uncertain: '发送结果不确定，先核对', disconnected: '会话失联，需重新核对',
  awaiting_answer: '待你回答 · 打开原窗格', monitor_disconnected: '原执行失联 · 核对窗格',
  blocked: '查看执行阻塞原因', execution_revision_changed: '任务修订与当前执行不同',
  evidence_stale: '旧证据或验收已失去当前版本覆盖',
  creation_pending: '启动待核对 · 任务尚未发送', execution_failed: '执行失败 · 可核对后重试', stop_pending: '停止待确认',
};
export const executionLabels: Record<string, string> = { sending: '正在发送', awaiting_receipt: '已发送 · 等待接收确认', accepted: '任务已接收', running: '有开始依据', blocked: '执行受阻', uncertain: '发送待核对', disconnected: '失联待核对', reported_finished: 'Agent 声明完成', failed: '执行失败', cancelled: '已确认取消', superseded: '已换会话 · 旧尝试保留' };
export const levelLabels: Record<EvidenceLevel, string> = { claim: 'Agent 分析', observed: '程序观察', user_confirmed: '本人核对', fixture: '虚构示例', stale: '出处已变 · 待复核' };
export interface RepositoryRef { id: string; label: string; path: string; scope: string[]; revision: number; createdAt: string }
export interface TaskPlan { projectId: string | null; goalId: string | null; phase: string }
export interface TaskProject { id: string; name: string; summary: string; repositoryIds: string[]; revision: number; createdAt: string; deleted?: boolean }
export interface AgentAccess { id: string; taskId: string; projectId: string; taskRevision: number; directory: string; active: boolean; createdAt: string; command: string; reason: string }
export interface Task {
  id: string; number: number; title: string; goal: string; scope: string[]; criteria: string[]; repositoryId: string | null;
  lifecycle: 'draft' | 'active' | 'paused' | 'cancelled'; pauseReason: string; source: string; resumeSummary: string;
  revision: number; createdAt: string; updatedAt: string;
}
export interface TerminalObservation { state: string; observedAt: string; stateSince: string; firstWorkingAt: string | null; reason: string }
export interface GitObservation { branch: string; head: string; path: string; changedFiles: number; observedAt: string; error: string }
export interface ExecutionWorkspace { path: string; branch: string; base: string }
export interface PanelMonitor { worktrees?: Record<string, GitObservation>; observedAt: string; error: string; sessions: HerdrSession[]; runs: Record<string, TerminalObservation>; git: GitObservation }
export interface TaskView extends Task {
  workspaceError?: string;
  executionWorkspace?: ExecutionWorkspace | null;
  executionProfile?: string; recommendedActions?: string[]; observation?: TerminalObservation | null;
  pendingCreation?: { kind: string; paneName: string; serverId: string | null; state: string; workspaceId: string | null; paneId: string | null; reason: string; binding: Binding | null } | null;
  stopPending?: boolean;
  plan: TaskPlan; objectKind: string;
  lane: Lane; reasonCodes: string[]; blockers: string[]; allowedActions: string[];
  prerequisitesTotal: number; prerequisitesSatisfied: number; executionState: string | null; checkState: string; acceptanceState: string;
}
export const liveExecution = (state: string | null | undefined) => ['sending','awaiting_receipt','accepted','running','blocked','uncertain','disconnected'].includes(state ?? '');
export interface Relation { id: string; fromId: string; toId: string; kind: string; threshold: string; source: string; evidenceLevel: EvidenceLevel; active: boolean; revision: number }
export interface Memory { id: string; taskId: string | null; repositoryId: string | null; kind: string; body: string; source: string; status: string; supersedes: string | null; baseTaskRevision: number | null; revision: number; createdAt: string; projectId?: string | null; category?: string; originLevel?: EvidenceLevel; sourceRefs?: unknown; stale?: boolean }
export interface TaskEvent { sequence: number; requestId: string; objectId: string; kind: string; actor: string; detail: string; createdAt: string }
export interface Execution { id: string; taskId: string; taskRevision: number; contextId: string; bindingId: string; bindingGeneration: number; state: string; attempt: number; requestId: string; authorization: string[]; snapshotId: string | null; reason: string; createdAt: string; updatedAt: string }
export interface Binding { id: string; taskId: string; serverId: string; workspaceId: string; paneId: string; agentId: string; kind: string; cwd: string; generation: number; state: string; checkedAt: string }
export interface TaskEvidence { id: string; taskId: string; executionId: string; taskRevision: number; kind: string; level: EvidenceLevel; status: string; path: string; hash: string; detail: unknown; snapshotId: string | null; createdAt: string }
export interface TaskFeedback { id:string; taskId:string; taskRevision:number; executionId:string; bindingGeneration:number; body:string; state:string; reason:string; response:string; createdAt:string; updatedAt:string }
export interface GraphNode { id: string; repositoryId: string | null; kind: string; label: string; path: string; symbol: string; evidenceLevel: EvidenceLevel; sources: unknown; stale: boolean }
export interface GraphView { graphRevision: number; nodes: GraphNode[]; relations: Relation[]; totalNodes: number; offset: number; hasMore: boolean; coverage: unknown[]; unknowns: string[] }
export interface GraphQuery { workspaceTaskId?: string | null; layer?: 'all' | 'execution' | 'code'; projectId?: string | null; taskId?: string | null; repositoryId?: string | null; kinds?: string[]; levels?: string[]; depth?: number; offset?: number; limit?: number }
export interface PanelSnapshot {
  feedback?: TaskFeedback[];
  monitor?: PanelMonitor;
  projects: TaskProject[];
  graphRevision: number; tasks: TaskView[]; repositories: RepositoryRef[]; relations: Relation[]; memories: Memory[];
  executions: Execution[]; bindings: Binding[]; evidence: TaskEvidence[]; events: TaskEvent[]; lastSequence: number;
}
/** Presentation filter only: deletion preserves every underlying record. */
export function activePanelSnapshot(snapshot: PanelSnapshot | null): PanelSnapshot | null {
  if (!snapshot || !snapshot.projects.some(project => project.deleted)) return snapshot;
  const deleted = new Set(snapshot.projects.filter(project => project.deleted).map(project => project.id));
  const hiddenRepositories = new Set(snapshot.projects.filter(project => project.deleted).flatMap(project => project.repositoryIds));
  const tasks = snapshot.tasks.filter(task => !task.plan.projectId || !deleted.has(task.plan.projectId));
  const visibleTasks = new Set(tasks.map(task => task.id));
  return { ...snapshot, projects: snapshot.projects.filter(project => !project.deleted), tasks,
    repositories: snapshot.repositories.filter(repository => !hiddenRepositories.has(repository.id)),
    memories: snapshot.memories.filter(memory => (!memory.projectId || !deleted.has(memory.projectId)) && (!memory.taskId || visibleTasks.has(memory.taskId)) && (!memory.repositoryId || !hiddenRepositories.has(memory.repositoryId))),
    feedback: snapshot.feedback?.filter(item => visibleTasks.has(item.taskId)), executions: snapshot.executions.filter(run => visibleTasks.has(run.taskId)), bindings: snapshot.bindings.filter(binding => visibleTasks.has(binding.taskId)), evidence: snapshot.evidence.filter(item => visibleTasks.has(item.taskId)) };
}
export type TaskMutation =
  | { type:'keep_task_without_worktree'; id:string; approved:boolean }
  | { type: 'cancel_stopped_execution'; id: string; executionId: string; reason: string; approved: boolean }
  | { type: 'project'; id: string; name: string; summary: string; repositoryIds: string[] }
  | { type: 'project_deleted'; id: string; deleted: boolean; approved: boolean }
  | { type: 'repository'; id: string; label: string; path: string; scope: string[]; projectId?: string | null }
  | { type: 'save_task'; id: string; title: string; goal: string; scope: string[]; criteria: string[]; repositoryId: string | null; source: string; plan?: TaskPlan }
  | { type: 'lifecycle'; id: string; lifecycle: string; reason: string }
  | { type: 'resume_summary'; id: string; summary: string }
  | { type: 'relation'; fromId: string; toId: string; kind: string; threshold: string; source: string }
  | { type: 'invalidate_relation'; id: string }
  | { type: 'review_relation'; id: string; reason: string }
  | { type: 'memory_draft'; id: string; taskId: string | null; repositoryId: string | null; kind: string; body: string; source: string; supersedes: string | null; projectId?: string | null }
  | { type: 'update_memory_draft'; id: string; body: string; source: string; kind: string }
  | { type: 'apply_memory' | 'cancel_memory'; id: string };
export interface MutationReceipt { objectId: string; revision: number; sequence: number }
export interface TaskDraft { worktreePending?:boolean; feedbackOnly?:boolean; feedbackText?:string; rawRequest?: string; refinementModel?: string; refinementQuestions?: string[]; refinementAnswer?: string; refinedRequest?: string; refinedRepositoryId?: string; manualTask?: boolean; newBranch?: string; autoStart?: boolean; agentKind?: string; paneName?: string; id: string; expectedRevision: number | null; title: string; goal: string; scope: string; criteria: string; repositoryId: string; source: string; projectId: string; goalId: string; phase: string }
export interface RepositoryDraft { id: string; label: string; path: string; scope: string; goal: string; skillPath: string; agentKind: string; paneName: string; exchangePath: string; paneId: string; step: number; projectId: string }
export interface FileSnapshot { path: string; hash: string; bytes: number; tracked: boolean; changed: boolean }
export interface WorkspaceSnapshot { id: string; repositoryId: string; head: string | null; files: FileSnapshot[]; changes: string; fingerprint: string; consistent: boolean; sampledAt: string; coverage: string[]; unknowns: string[] }
export interface ContextPackage { id: string; taskId: string; taskRevision: number; graphRevision: number; title: string; goal: string; scope: string[]; acceptanceCriteria: string[]; workspaceSnapshot: WorkspaceSnapshot | null; dependencies: Relation[]; decisions: Memory[]; relatedFiles: GraphNode[]; relatedObjects?: GraphNode[]; impactCandidates: Relation[]; resumeSummary: string; sourceRefs: string[]; missingInformation: string[]; hash: string; plan?: TaskPlan; project?: TaskProject | null; references?: Memory[]; evidence?: TaskEvidence[]; scopeHash?: string; omittedItems?: number }
export interface HerdrConfig { executable: string; session: string }
export interface HerdrCapabilities { executable: string | null; version: string | null; apiProtocol: number | null; serviceVersion: string | null; serviceProtocol: number | null; transport: string; methods: string[]; identityFields: string[]; declaredEvents: string[]; limitations: string[]; observedAt: string; connected: boolean; fixture: boolean; reason: string }
export interface HerdrSession { serverId: string; workspaceId: string; paneId: string; agentId: string; terminalId: string; kind: string; name: string | null; cwd: string; state: string; interactiveReady: boolean; identityConfirmed: boolean; identitySource: 'native_session' | 'local_process' | 'unverified'; processId: number | null; processCreatedAt: string | null; fixture: boolean; observedAt: string }
export interface ImportPreview {
  id: string; analysisId: string; hash: string; repositoryId: string; baseGraphRevision: number; status: string; errors: string[]; warnings: string[];
  sourceReviews: { sourceId: string; path: string; located: boolean; reason: string; semanticStatus: string }[];
  facts: { schema_version: number; analysis_id: string; revision: string | null; scope: string[]; coverage: unknown; unknowns: string[]; nodes: { id: string; label: string; kind: string; path: string }[]; relations: { id: string; from: string; to: string; kind: string; sources: string[]; inference: string | null }[]; proposals: unknown[]; changes: unknown[]; artifacts: unknown };
}
export interface ResultReview { id: string; executionId: string; status: string; errors: string[]; originalHash: string; observedSnapshotId: string | null; raw: unknown }
export interface RecoveryPreview { task: Task; execution: Execution; files: { path: string; beforeHash: string | null; currentHash: string | null; change: string; restorable: boolean; reason: string }[]; evidence: TaskEvidence[]; missing: string[]; currentFingerprint: string | null; preservedSources: string[]; affectedTasks: string[] }
export interface GoalInput { title: string; goal: string; requirements: string[]; decisions: string[]; tasks: { title: string; goal: string; scope: string[]; criteria: string[] }[]; dependencies: { task: number; prerequisite: number; threshold?: 'acceptance' | 'technical' }[]; designs: string[]; source: string; approved: boolean; parentRepositoryId: string | null; newDirectory: string; initializeGit: boolean; installDependencies: boolean; projectId?: string | null }
export interface GoalReceipt { goalId: string; taskIds: string[]; initializationTaskId: string | null; graphRevision: number; warnings: string[]; projectId: string }
export const newTaskDraft = (): TaskDraft => ({ rawRequest: '', autoStart: false, agentKind: 'codex', paneName: '', id: crypto.randomUUID(), expectedRevision: null, title: '', goal: '', scope: '', criteria: '', repositoryId: '', source: '本人创建', projectId: '', goalId: '', phase: '' });
export const taskDraft = (task: TaskView): TaskDraft => ({ autoStart: false, agentKind: 'codex', paneName: task.title, id: task.id, expectedRevision: task.revision, title: task.title, goal: task.goal, scope: task.scope.join('\n'), criteria: task.criteria.join('\n'), repositoryId: task.repositoryId ?? '', source: task.source, projectId: task.plan.projectId ?? '', goalId: task.plan.goalId ?? '', phase: task.plan.phase });
export const nonEmptyLines = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export const taskNumber = (task: Pick<Task, 'number'>) => `TP-${String(task.number).padStart(3, '0')}`;
export function taskError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  if (typeof error === 'string') return error;
  return '任务操作未完成，输入和现有记录已保留。';
}
