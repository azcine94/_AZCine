import { useEffect, useMemo, useState } from 'react';
import { useTaskPanel } from '../use-task-panel.ts';
import type { TaskPanelController } from '../use-task-panel.ts';
import { activePanelSnapshot, liveExecution, newTaskDraft, nonEmptyLines, taskDraft } from '../task-panel-contract.ts';
import type { ContextPackage, Execution, GraphNode, GraphQuery, GraphView, PanelSnapshot, Relation, TaskEvidence, TaskView } from '../task-panel-contract.ts';
import { taskFlowView } from '../task-panel-graph-layout.ts';
import { notifyOperation } from '../components/ui/operation-toast.tsx';

const at = '2026-10-07T02:30:00+08:00';
const refinementStates = ['task-panel-create', 'task-panel-create-manual', 'task-panel-refining', 'task-panel-refine-questions', 'task-panel-refine-ready', 'task-panel-refine-error', 'task-panel-refine-stale', 'task-panel-refine-no-model', 'task-panel-refine-long'];
const projectManagementStates = ['task-panel-project-manager', 'task-panel-project-delete-confirm', 'task-panel-project-deleted', 'task-panel-project-delete-error'];
const branchStates = ['task-panel-branches', 'task-panel-branch-clean', 'task-panel-branch-pending', 'task-panel-branch-error', 'task-panel-branch-stale', 'task-panel-branch-long'];
const collaborationStates=['task-panel-feedback-pending','task-panel-feedback-response','task-panel-revision-edit','task-panel-worktree-retry','task-panel-draft-restored','task-panel-workspace-unavailable'];
const deliveryStates = ['task-panel-delivery-user-required','task-panel-delivery','task-panel-delivery-unverified','task-panel-delivery-required','task-panel-delivery-stale','task-panel-delivery-long','task-panel-delivery-error'];
const graphStateScenes = ['task-panel-graph-loading','task-panel-graph-empty','task-panel-graph-error'];
const recordStates = [...deliveryStates,'task-panel-checks-stale','task-panel-task-flow', 'task-panel-records', 'task-panel-records-history', 'task-panel-records-unnamed', 'task-panel-records-long'];
const overviewStates = ['task-panel-overview', 'task-panel-overview-selected', 'task-panel-overview-long'];
const refinementModel = { key: JSON.stringify(['fixture-provider', 'fixture-model']), provider: 'fixture-provider', id: 'fixture-model', name: '虚构细化模型' };
const refinementExample = { title: '让任务详情优先显示任务内容', goal: '## 本次目标\n打开任务详情后，先看到这次要做什么。\n\n## 具体改动\n优先展示目标、范围和完成条件；运行、Git 与交接约定默认折叠。\n\n## 限制\n保留完整原文，复用现有亮暗主题，不改变派发行为。\n\n## 完成条件\n任务内容清晰可读，技术详情仍可展开查阅。\n\n## 代码依据\nUI 总览虚构示例，没有实际查证源码。', scope: 'src', criteria: '打开详情先看到任务内容\n完整技术原文可展开\n保留现有任务派发行为' };
function sample(number: number, title: string, lane: TaskView['lane']): TaskView {
  return { plan: { projectId: 'fixture-project', goalId: 'fixture-goal', phase: '任务闭环' }, objectKind: 'task', id: `fixture-task-${number}`, number, title, goal: '按已确认范围补齐真实功能与交付依据。', scope: ['src'], criteria: ['保存后能重开接续', '前置与交付状态同源', '失败保留输入'], repositoryId: 'fixture-repository', lifecycle: 'active', pauseReason: '', source: 'UI 总览 · 虚构示例', resumeSummary: '已保存任务与决定，下次从当前暂停点继续。', revision: 3, createdAt: at, updatedAt: at, lane, reasonCodes: lane === 'human' ? ['missing_scope'] : lane === 'blocked' ? ['prerequisites'] : [], blockers: lane === 'blocked' ? ['fixture-task-110'] : [], allowedActions: lane === 'ready' ? ['edit', 'context', 'bind', 'dispatch'] : ['edit', 'context'], prerequisitesTotal: lane === 'blocked' ? 1 : 0, prerequisitesSatisfied: 0, executionState: lane === 'running' ? 'running' : lane === 'verify' ? 'reported_finished' : null, checkState: 'not_run', acceptanceState: lane === 'done' ? 'accepted' : 'not_accepted' };
}
export function taskPanelFixture(state: string): PanelSnapshot {
  const tasks = state === 'empty' ? [] : [sample(104, '选择要绑定的 Herdr server 与工作区', 'human'), sample(108, '依赖计算与阻塞原因解释', 'blocked'), sample(109, 'Herdr 会话列表与绑定', 'blocked'), sample(110, '派发预览与任务上下文包', 'running'), sample(111, '结果回执解析与证据登记', 'ready'), sample(112, '首次了解 previz-engine：Archify 建图', 'human'), sample(113, '修复关键帧插值跳变', 'ready'), sample(115, '关系图邻域查询、分页与截断提示', 'blocked'), sample(116, '交付文件与版本核对', 'verify')];
  if (state !== 'empty') {
    const goal = { ...sample(100, '完成影视工具任务闭环', 'human'), id: 'fixture-goal', objectKind: 'goal', repositoryId: null, plan: { projectId: 'fixture-project', goalId: null, phase: '' }, scope: [] };
    const other = { ...sample(201, '资产库：等待 Agent 接收确认', 'running'), repositoryId: 'fixture-repository-b', plan: { projectId: 'fixture-project-b', goalId: null, phase: '资产整理' }, executionState: 'awaiting_receipt' };
    tasks.push(goal, other);
  }
  if (state === 'long') for (const t of tasks) { t.title += ' · 包含长名称、中文标点及多个相关文件的任务'.repeat(5); t.goal = '长目标与理由。'.repeat(60); t.plan.phase = '包含较长名称的阶段与待核对事项'.repeat(3); }
  const branchPath='C:/AZCineTest/previz-engine/.azcine/worktrees/fix-component-color';
  const branchTask=tasks.find(t => t.id==='fixture-task-113');
  if(branchTask) branchTask.executionWorkspace={path:branchPath,branch:'fix/component-color',base:'fixture-head'};
  if (branchTask?.executionWorkspace && state === 'task-panel-branch-long') branchTask.executionWorkspace.branch = 'fix/task-panel-long-branch-name-with-repository-observation-and-clear-status';
  if (branchTask?.executionWorkspace && state === 'task-panel-overview-long') { branchTask.executionWorkspace.branch = 'fix/task-panel-overview-show-all-tasks-with-long-branch-and-workspace-context'; branchTask.title += ' · 包含很长的任务名称与工作区说明'.repeat(5); }
  if (state === 'task-panel-no-code') { const task = tasks.find(item => item.id === 'fixture-task-112'); if (task) task.repositoryId = null; }
  if (branchTask && state === 'task-panel-task-content') {
    branchTask.title = '将主操作按钮改为绿色';
    branchTask.goal = '将主操作按钮的默认背景改为 `#166534`，悬停背景改为 `#14532d`。\n\n只调整 `src/styles/globals.css` 中的 `.btn-primary` 和悬停样式，保留禁用状态和其他按钮。\n\n不运行测试，不修改认证、共享组件或其他项目文件。';
    branchTask.scope = ['src/styles/globals.css'];
    branchTask.criteria = ['主按钮默认与悬停状态使用指定颜色', '其他按钮和禁用状态保持原有行为', '交付列出实际改动，并如实记录未运行检查'];
    branchTask.lane = 'verify'; branchTask.executionState = 'reported_finished';
  }
  const target = tasks.find(t => t.id === 'fixture-task-112');
  if (target && state === 'task-panel-task-protocol') {
    target.title = '分析仓库的代码结构与数据交换';
    target.goal = '按所选 Archify Skill 在允许范围 ["src"] 查证任务面板的组件、调用关系和数据交换。只读源码，生成可打开的结构图并注明出处。任务包 allowed_actions 中 render_architecture 就是这次渲染授权。先用包中的 agent_cli 按 --help 提交 accepted_or_blocked 接收回执。阻塞和完成也必须调用 submit_result。交付原生 candidate.json、architecture.html 和独立 graph-facts.json v1。三件产物必须共享 analysis_id、真实 HEAD/未提交快照基线及本次 run/context。graph-facts 字段：schema_version=1,analysis_id,run_id,context_id,repository_ref=fixture-repository,revision,sources[{id,path,line_start,line_end,sha256,statement}]。初始图基线使用派发包 graphRevision。不修改源码，不安装依赖，不运行项目测试。产物交到本次派发包 output_directory。';
    target.criteria = ['结构图能说明主要组件如何调用', '数据交换与代码出处可追溯', '交付说明实际完成项与未验证项'];
    target.source = 'UI 总览虚构分析任务；SHA256=fixture-not-a-real-hash；产物目录=C:/AZCineTest/fixture-output';
    target.scope = ['src']; target.reasonCodes = []; target.lane = 'ready';
  }
  if (target && ['task-panel-start-failed','task-panel-paused','task-panel-cancelled','long'].includes(state)) {
    target.pendingCreation = { kind: 'codex', paneName: '虚构仓库 · 建图', serverId: 'fixture-only', state: 'uncertain', workspaceId: 'fixture-workspace', paneId: 'fixture-pane', binding: null, reason: '示例：原窗格已创建，Agent 启动待核对；任务尚未发送。' };
    target.reasonCodes = ['creation_pending']; target.allowedActions = ['edit','context','bind','dispatch'];
    if (state === 'task-panel-paused') { target.lifecycle = 'paused'; target.reasonCodes.unshift('paused'); target.allowedActions = ['edit','context']; }
    if (state === 'task-panel-cancelled') { target.lifecycle = 'cancelled'; target.reasonCodes = ['cancelled']; target.allowedActions = ['edit','context']; }
  }
  if (target && ['task-panel-stopping','task-panel-stop-confirm'].includes(state)) {
    target.lane = 'running'; target.executionState = 'running'; target.stopPending = true; target.reasonCodes = ['stop_pending']; target.allowedActions = ['edit','context'];
  }
  if (state === 'conflict') tasks[0].revision = 4;
  const observedAt = new Date().toISOString();
  const branchGit = { branch: branchTask?.executionWorkspace?.branch || 'fix/component-color', head: 'fixture-head', path: branchPath, changedFiles: state === 'task-panel-branch-clean' ? 0 : 1, observedAt: state === 'task-panel-branch-stale' ? new Date(Date.now() - 60000).toISOString() : observedAt, error: state === 'task-panel-branch-error' ? '虚构示例：任务执行目录不可读取，改动数未知。' : '' };
  const sessions = ['working','blocked','unknown'].map((status,i)=>({ serverId:'fixture-only',workspaceId:'fixture-workspace',paneId:`fixture-pane-${i+1}`,agentId:`fixture-agent-${i+1}`,terminalId:`fixture-terminal-${i+1}`,kind:i===1?'pi':'codex',name:null,cwd:i===1?'C:/AZCineTest/asset-library':'C:/AZCineTest/previz-engine',state:status,interactiveReady:false,identityConfirmed:false,identitySource:'unverified' as const,processId:null,processCreatedAt:null,fixture:true,observedAt }));
  const snapshot: PanelSnapshot = { monitor:{observedAt,error:'UI 虚构示例 · 未连接 Herdr',sessions,runs:{},worktrees:state === 'task-panel-branch-pending' ? {} : {[branchPath]:branchGit},git:{branch:'main',head:'fixture-head',path:'C:/AZCineTest/previz-engine',changedFiles:1,observedAt,error:''}}, projects: [{ id: 'fixture-project', name: state === 'long' ? '影视预演工具与场景资产管理长项目名称'.repeat(3) : '影视预演工具', summary: '本项目目标、代码与记忆分别可追溯。', repositoryIds: ['fixture-repository'], revision: 1, createdAt: at }, { id: 'fixture-project-b', name: '素材资产库', summary: '独立目录与独立 Herdr 会话推进。', repositoryIds: ['fixture-repository-b'], revision: 1, createdAt: at }], graphRevision: 3, tasks, repositories: [{ id: 'fixture-repository', label: 'previz-engine', path: 'C:\\AZCineTest\\previz-engine', scope: ['src'], revision: 1, createdAt: at }, { id: 'fixture-repository-b', label: 'asset-library', path: 'C:\\AZCineTest\\asset-library', scope: ['src'], revision: 1, createdAt: at }], relations: tasks.filter(t => t.lane === 'blocked').map(t => ({ id: `fixture-rel-${t.number}`, fromId: t.id, toId: 'fixture-task-110', kind: 'depends_on', threshold: 'acceptance', source: '虚构的本人决定', evidenceLevel: 'fixture', active: true, revision: 1 })), memories: [{ projectId: 'fixture-project', category: 'decision', originLevel: 'user_confirmed', sourceRefs: [{ description: '虚构的本人决定' }], stale: false, id: 'fixture-memory-1', taskId: null, repositoryId: null, kind: 'decision', body: '先保留来源和代码版本，关系导入由本人核对，不从图的颜色推断业务状态。', source: 'UI 总览虚构资料', status: 'active', supersedes: null, baseTaskRevision: 3, revision: 1, createdAt: at }, { projectId: 'fixture-project', category: 'reference', originLevel: 'claim', sourceRefs: [{ id: 'fixture-source', path: 'src/interpolation.ts', sha256: 'fixture-not-a-real-hash' }], stale: false, id: 'fixture-memory-2', taskId: 'fixture-task-113', repositoryId: null, kind: 'memory', body: '首次分析有三项未知，需要限定范围补充查证。', source: '虚构 Agent 交付片段', status: 'draft', supersedes: null, baseTaskRevision: 3, revision: 1, createdAt: at }, { id: 'fixture-memory-3', taskId: null, repositoryId: null, projectId: 'fixture-project-b', kind: 'decision', body: '建议调整资产导入范围，等待本人确认。', source: '虚构 Agent 建议', category: 'decision', originLevel: 'claim', sourceRefs: [], stale: false, status: 'draft', supersedes: null, baseTaskRevision: null, revision: 1, createdAt: at }], executions: tasks.filter(t => t.lane === 'running').map(t => ({ id: 'fixture-run-' + t.number, taskId: t.id, taskRevision: t.revision, contextId: 'fixture-context-' + t.number, bindingId: 'fixture-binding-' + t.number, bindingGeneration: 1, state: t.executionState ?? 'running', attempt: 1, requestId: 'fixture-request-' + t.number, authorization: [], snapshotId: null, reason: 'UI 虚构执行观察，未连接实际 Herdr。', createdAt: at, updatedAt: at })), bindings: [], evidence: [], events: tasks.map((t, i) => ({ sequence: i + 1, requestId: `fixture-event-${i}`, objectId: t.id, kind: t.pendingCreation ? 'herdr_creation_observation' : 'mutation', actor: 'user', detail: t.pendingCreation ? JSON.stringify(t.pendingCreation) : '虚构任务已保存，实际未执行任何外部操作。', createdAt: at })), lastSequence: tasks.length };
  if (recordStates.includes(state)) addTaskRecordsFixture(snapshot, state);
  if(deliveryStates.includes(state)) {
    const task=snapshot.tasks.find(t=>t.id==='fixture-task-113')!;
    task.checkState=state==='task-panel-delivery-user-required'?'not_run':state==='task-panel-delivery-stale'?'stale':state==='task-panel-delivery-unverified'||state==='task-panel-delivery-required'?'not_run':'passed';
    if(state==='task-panel-delivery-long') {task.title+=' · 很长的任务名称'.repeat(8);task.criteria=task.criteria.map(c=>c.repeat(12));}
    if(state==='task-panel-delivery-unverified'||state==='task-panel-delivery-required')snapshot.evidence=snapshot.evidence.filter(e=>e.level!=='user_confirmed');
    if(state==='task-panel-delivery-required') {const check=snapshot.evidence.find(e=>e.id==='fixture-evidence-claim')!;check.detail={command:'虚构主按钮检查',id:'fixture-required-check',required:true,exit_code:0,coverage:['src/styles/globals.css'],reportedLog:{path:'C:/ui-fixture/check.log',hash:'fixture-only',preview:'UI 虚构日志：未运行真实命令。\n声明已检查默认和悬停颜色。'}};}
    if(state==='task-panel-delivery-user-required') snapshot.evidence.unshift({id:'fixture-user-required',taskId:task.id,executionId:'fixture-run-113',taskRevision:task.revision,kind:'check',level:'user_confirmed',status:'not_run',path:'',hash:'fixture-only',snapshotId:'fixture-snapshot-113',createdAt:at,detail:{id:'fixture-user-check',command:'虚构示例：本人明确要求验收前通过的检查',required:true,coverage:['src/styles/globals.css']}});
    if(state==='task-panel-delivery-stale') for(const e of snapshot.evidence)e.detail={...(e.detail as object),validity:{current:false,reason:'虚构示例：代码已变化，需要重新交付'}};
  }
  if (state==='task-panel-checks-stale') { const task=snapshot.tasks.find(t=>t.id==='fixture-task-113');if(task)task.checkState='stale'; for(const e of snapshot.evidence) if(e.taskId===task?.id && e.detail && typeof e.detail==='object')e.detail={...e.detail,validity:{current:false,reason:'当前代码已变化，需重新检查'}}; }
  if(collaborationStates.includes(state)) {
    const task=snapshot.tasks.find(t=>t.id==='fixture-task-113')!;
    if(['task-panel-feedback-pending','task-panel-feedback-response','task-panel-revision-edit'].includes(state)) {
      task.lane='running';task.executionState='running';
      const run:Execution={id:'fixture-run-113',taskId:task.id,taskRevision:task.revision,contextId:'fixture-context-113',bindingId:'fixture-binding-113',bindingGeneration:1,state:'running',attempt:1,requestId:'fixture-request-113',authorization:[],snapshotId:null,reason:'虚构 Agent：已定位样式，正在处理长文本布局。',createdAt:at,updatedAt:at};snapshot.executions.push(run);
      snapshot.feedback=[{id:'fixture-feedback',taskId:task.id,taskRevision:task.revision,executionId:run.id,bindingGeneration:1,body:'分支名称可以省略显示，但展开后要能看完整路径。',state:state==='task-panel-feedback-response'?'addressed':'pending',reason:state==='task-panel-feedback-response'?'Agent 回报已处理，尚需核对':'已保存，等待原会话可接收',response:state==='task-panel-feedback-response'?'虚构回应：已增加完整路径提示，尚未运行界面验证。':'',createdAt:at,updatedAt:at}];
    }
    if(state==='task-panel-feedback-response') snapshot.memories.push({id:'fixture-agent-question',taskId:task.id,repositoryId:task.repositoryId,projectId:task.plan.projectId,kind:'requirement',body:'虚构建议：长分支名省略显示，完整路径放到提示与详情中。',source:'UI 虚构 Agent 建议',status:'draft',supersedes:null,baseTaskRevision:task.revision,revision:1,createdAt:at,stale:false,originLevel:'claim',category:'decision',sourceRefs:[]});
    if(state==='task-panel-worktree-retry'){task.executionWorkspace=null;task.reasonCodes=['worktree_pending'];task.lane='human';}
    if(state==='task-panel-workspace-unavailable'){task.workspaceError='虚构示例：原任务 Worktree 不可读取，请恢复原目录。';task.reasonCodes=['workspace_unavailable'];task.lane='human';}
  }
  return snapshot;
}
function addTaskRecordsFixture(snapshot: PanelSnapshot, state: string) {
  const task = snapshot.tasks.find(item => item.id === 'fixture-task-113');
  if (!task) return;
  task.title = '让主操作按钮使用绿色'; task.lane = 'verify'; task.executionState = 'reported_finished';
  const oldAt = '2026-10-06T02:30:00+08:00', earlierAt = '2026-10-07T02:29:00+08:00';
  const run: Execution = { id: 'fixture-run-113', taskId: task.id, taskRevision: task.revision, contextId: 'fixture-context-113', bindingId: 'fixture-binding-113', bindingGeneration: 1, state: 'reported_finished', attempt: 2, requestId: 'fixture-request-113', authorization: [], snapshotId: 'fixture-snapshot-113', reason: 'UI 虚构执行，未运行实际模型或命令。', createdAt: at, updatedAt: at };
  snapshot.executions.push(run);
  snapshot.bindings.push({ id: run.bindingId, taskId: task.id, serverId: 'fixture-only', workspaceId: 'fixture-workspace', paneId: 'fixture-pane-113', agentId: 'fixture-agent-113', kind: 'codex', cwd: task.executionWorkspace!.path, generation: 1, state: 'bound', checkedAt: at });
  const item = (id: string, kind: string, status: string, detail: unknown, level: TaskEvidence['level'] = 'observed'): TaskEvidence => ({ id: 'fixture-evidence-' + id, taskId: task.id, executionId: run.id, taskRevision: task.revision, kind, status, detail, level, path: '', hash: 'fixture-not-a-real-hash', snapshotId: run.snapshotId, createdAt: at });
  const command = state === 'task-panel-records-long' ? '虚构检查：主按钮默认与悬停颜色、禁用状态及长名称控件的静态声明'.repeat(8) : '虚构检查：主按钮颜色声明';
  const claim = item('claim', 'check', 'passed', { command: state === 'task-panel-records-unnamed' ? '' : command, reason: 'UI 虚构 Agent 回报，不代表真实检查通过。', coverage: ['src/styles/globals.css'] }, 'claim');
  snapshot.evidence.push(claim, item('unnamed', 'check', 'not_run', { reason: '虚构示例：没有运行界面验证。' }, 'claim'), item('file-check', 'file_check', 'passed', { actualChangedFiles: ['src/styles/globals.css'], claimedChangedFiles: ['src/styles/globals.css'], errors: [] }), item('artifact', 'artifact', 'located', { originalPath: `C:/AZCineTest/delivery/${state === 'task-panel-records-long' ? '很长的主按钮颜色改动说明'.repeat(12) : 'button-color-delivery'}.md`, semanticStatus: 'not_reviewed', fixture: true }), item('receipt', 'receipt', 'matched', { errors: [], raw: { resume_summary: '虚构交付：已调整颜色，尚未运行界面验证。', remaining_items: ['本人核对按钮颜色与禁用状态'], fixture: true } }, 'claim'));
  if (state !== 'task-panel-records-unnamed') snapshot.evidence.push(item('confirmed', 'check', 'passed', { command, exitCode: 0, coverage: ['src/styles/globals.css'], reason: 'UI 虚构本人核对，未执行任何真实检查。' }, 'user_confirmed'));
  if (state === 'task-panel-records-history') {
    const old: Execution = { ...run, id: 'fixture-old-run-113', taskRevision: 2, attempt: 1, state: 'failed', createdAt: oldAt, updatedAt: oldAt };
    snapshot.executions.push(old);
    snapshot.evidence.push({ ...item('old-check', 'check', 'failed', { command, reason: 'UI 虚构旧任务修订记录。' }, 'claim'), executionId: old.id, taskRevision: 2, createdAt: oldAt }, { ...claim, id: 'fixture-evidence-earlier', status: 'not_run', createdAt: earlierAt });
  }
  if (state === 'task-panel-task-flow') {
    const relation = (id: string, fromId: string, toId: string): Relation => ({ id, fromId, toId, kind: 'depends_on', threshold: 'acceptance', source: 'UI 虚构前置关系', evidenceLevel: 'fixture', active: true, revision: 1 });
    snapshot.relations.push(relation('fixture-before-113', task.id, 'fixture-task-110'), relation('fixture-after-113', 'fixture-task-116', task.id));
  }
}

export function usePreviewTaskPanel(state: string): TaskPanelController {
  const base = useTaskPanel(null, false);
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const [feedbackInputs,setFeedbackInputs]=useState<Record<string,string>>({});
  const [refining, setRefining] = useState(state === 'task-panel-refining');
  const [refineError, setRefineError] = useState(state === 'task-panel-refine-error' ? '虚构示例：模型连接失败，需求和已有草案保留。' : '');
  useEffect(() => {
    if (!refinementStates.includes(state)) return;
    const rawRequest = '任务详情太乱了，我想先看到这次要做什么，技术信息默认收起来。';
    const prepared = ['task-panel-create-manual', 'task-panel-refine-ready', 'task-panel-refine-stale', 'task-panel-refine-error', 'task-panel-refine-long'].includes(state);
    base.updateDraft({ ...newTaskDraft(), id: 'fixture-new-task', projectId: 'fixture-project', repositoryId: 'fixture-repository', refinementModel: refinementModel.key, rawRequest: state === 'task-panel-refine-long' ? rawRequest.repeat(70) : rawRequest,
      ...(prepared ? { ...refinementExample, refinedRequest: state === 'task-panel-refine-stale' ? '之前的需求' : state === 'task-panel-refine-long' ? rawRequest.repeat(70) : rawRequest, refinedRepositoryId: 'fixture-repository' } : {}),
      ...(state === 'task-panel-create-manual' ? { manualTask: true, title: '', goal: '', criteria: '' } : {}),
      ...(state === 'task-panel-refine-long' ? { goal: refinementExample.goal.repeat(12), title: refinementExample.title.repeat(6) } : {}),
      refinementQuestions: state === 'task-panel-refine-questions' ? ['技术信息折叠后是否仍需要查看完整原文？', '是否只修改任务详情，保留任务卡片？'] : [], source: 'UI 总览 · 虚构细化草案' });
  }, [state]);
  useEffect(() => { if (state === 'task-panel-graph' || state === 'task-panel-task-flow') base.setGraphMode('task'); else if (state === 'task-panel-code-graph' || state === 'task-panel-graph-long') base.setGraphMode('architecture'); }, [state]);
  useEffect(() => { if (state === 'task-panel-memory-reference') base.setMemoryFilter('reference'); else if (state === 'task-panel-memory-pending') base.setMemoryFilter('pending'); else base.setMemoryFilter('active'); }, [state]);
  const [snapshot, setSnapshot] = useState(() => {
    const fixture = taskPanelFixture(state);
    if (projectManagementStates.includes(state)) fixture.projects.unshift({ id: 'fixture-project-empty', name: '虚构待整理项目', summary: '只用于 UI 总览的删除与恢复示例。', repositoryIds: [], revision: 1, createdAt: at, deleted: state === 'task-panel-project-deleted' });
    return fixture;
  });
  useEffect(()=>{if(!['task-panel-revision-edit','task-panel-worktree-retry','task-panel-draft-restored'].includes(state))return; const task=snapshot.tasks.find(t=>t.id==='fixture-task-113')!; base.updateDraft(state==='task-panel-draft-restored'?{...newTaskDraft(),...refinementExample,manualTask:true,autoStart:false,projectId:'fixture-project',repositoryId:'fixture-repository'}:{...taskDraft(task),newBranch:state==='task-panel-worktree-retry'?'fix/component-color':'',autoStart:false});base.closeEditor(true);},[state]);
  const visibleSnapshot = useMemo(() => activePanelSnapshot(snapshot)!, [snapshot]);
  const projectTaskCounts: Record<string, number> = {};
  for (const task of snapshot.tasks) if (task.plan.projectId && task.objectKind !== 'goal') projectTaskCounts[task.plan.projectId] = (projectTaskCounts[task.plan.projectId] ?? 0) + 1;
  useEffect(() => { if (state === 'task-panel-cancelled') base.setShowCancelled(true); if (state === 'task-panel-stop-confirm') base.workflow.setCancelTaskId('fixture-task-112'); }, [state]);
  const [error, setError] = useState(state==='task-panel-worktree-retry'?'虚构示例：任务已保存，分支尚未创建，可以重试或仅保留任务。':state === 'error' || state === 'conflict' ? '示例：保存失败或正式记录已改变，原内容与草稿保留。' : '');
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [graphLayer,setGraphLayer]=useState<GraphQuery['layer']>(undefined);
  useEffect(()=>{if(deliveryStates.includes(state)){base.workflow.setDeliveryTaskId('fixture-task-113');base.workflow.setDeliveryOpen(true);}},[state]);
  const notify = () => notifyOperation('UI 示例：只改变本页虚构记录。');
  async function saveTask() {
    if (state === 'error' || state === 'conflict') { setError('示例：旧修订未覆盖新记录，输入保留。'); return null; }
    const task: TaskView = { ...sample(snapshot.tasks.length + 120, base.draft.title, 'ready'), id: base.draft.id, title: base.draft.title, goal: base.draft.goal, scope: nonEmptyLines(base.draft.scope), criteria: nonEmptyLines(base.draft.criteria), repositoryId: base.draft.repositoryId || null, plan: { projectId: base.draft.projectId || null, goalId: base.draft.goalId || null, phase: base.draft.phase }, revision: (base.draft.expectedRevision ?? 0) + 1 };
    setSnapshot(before => ({ ...before, tasks: [...before.tasks.filter(t => t.id !== task.id), task] }));
    base.closeEditor(false); base.updateDraft(newTaskDraft()); notify(); return { objectId: task.id, revision: task.revision, sequence: 0 };
  }
  return { ...base, isPreview:true, root: 'C:\\ui-fixture\\repository', workspaces: [{ path: 'C:\\ui-fixture\\repository', label: '虚构工作仓库' }], openWorkspace: async () => { notify(); return null; }, snapshot: state === 'task-panel-initial-sync' ? null : visibleSnapshot, projectCatalog: snapshot.projects, projectTaskCounts, selectedId: selection !== undefined ? selection : base.selectedId ?? (['empty', 'task-panel-total-git', 'task-panel-overview'].includes(state) ? null : branchStates.includes(state) || recordStates.includes(state) || overviewStates.includes(state) || collaborationStates.includes(state) || state === 'task-panel-task-content' ? 'fixture-task-113' : 'fixture-task-112'), select: id => { setSelection(previous => typeof id === 'function' ? id(previous ?? base.selectedId ?? null) : id); base.select(id); }, loading: ['loading', 'task-panel-syncing', 'task-panel-initial-sync'].includes(state), loadError: state === 'error' || state === 'task-panel-sync-error' ? '示例读取失败，保留现有任务。' : '', action: state === 'pending' ? '保存结果待核对' : '', actionError: error, setActionError: setError, graph, graphLayer, graphLoading:state==='task-panel-graph-loading',graphError:state==='task-panel-graph-error'?'虚构示例：关系图读取失败。':'',
    tab: (['task-panel-graph','task-panel-code-graph','task-panel-graph-long','task-panel-task-flow'].includes(state) || overviewStates.includes(state) || graphStateScenes.includes(state)) ? 'graph' : state.startsWith('task-panel-memory') ? 'memory' : state === 'task-panel-sessions' ? 'sessions' : base.tab,
    editorOpen: refinementStates.includes(state) || state === 'dirty' || state === 'conflict' || state === 'task-panel-editor' || base.editorOpen,
    feedbackText:task=>feedbackInputs[task.id] || '',updateFeedback:(task,body)=>setFeedbackInputs(p=>({...p,[task.id]:body})),cancelFeedback:async(_task,_run,id)=>{setSnapshot(p=>({...p,feedback:p.feedback?.map(f=>f.id===id?{...f,state:'cancelled',reason:'虚构意见已撤回'}:f)}));notify();},
    sendFeedback:async(task,executionId)=>{const body=feedbackInputs[task.id]?.trim();if(!body)return;setSnapshot(p=>({...p,feedback:[...(p.feedback || []),{id:crypto.randomUUID(),taskId:task.id,taskRevision:task.revision,executionId,bindingGeneration:1,body,state:'pending',reason:'UI 虚构示例：意见已保存，未发送到真实 Agent。',response:'',createdAt:at,updatedAt:at}]}));setFeedbackInputs(p=>({...p,[task.id]:''}));notify();},
    refinement: { ...base.refinement, models: state === 'task-panel-refine-no-model' ? [] : [refinementModel], loadingModels: false, modelError: state === 'task-panel-refine-no-model' ? '虚构示例：没有配置模型，请先到工作台 Agent 设置中添加。' : '', busy: refining, phase: refining ? '正在细化需求' : '', error: refineError,
      refreshModels: async () => { notify(); }, chooseModel: key => base.updateDraft({ refinementModel: key }), cancel: () => setRefining(false),
      refine: async () => { setRefining(false); setRefineError(''); const rawRequest = [base.draft.rawRequest, base.draft.refinementAnswer ? `补充回答：\n${base.draft.refinementAnswer}` : ''].filter(Boolean).join('\n\n'); base.updateDraft({ ...refinementExample, rawRequest, refinementAnswer: '', refinementQuestions: [], refinedRequest: rawRequest.trim(), refinedRepositoryId: base.draft.repositoryId, manualTask: false, source: 'UI 总览 · 虚构细化草案' }); notify(); } },
    intakeOpen: ['task-panel-intake','task-panel-intake-launch'].includes(state) || base.intakeOpen,
    intake: state === 'task-panel-intake-launch' ? { ...base.intake, id: 'fixture-repository', label: '虚构工作仓库', path: 'C:\\ui-fixture\\repository', step: 2, paneName: '虚构工作仓库 · 建图' } : base.intake,
    projectOpen: state === 'task-panel-project' || base.projectOpen,
    projectManagerOpen: projectManagementStates.includes(state) || base.projectManagerOpen,
    setProjectDeleted: async (project, deleted) => {
      setError('');
      if (state === 'task-panel-project-delete-error') { setError('虚构示例：删除未完成，项目和任务保留。'); return null; }
      if (snapshot.projects.find(item => item.id === project.id)?.revision !== project.revision) { setError('虚构示例：项目版本已变化，请刷新后核对。'); return null; }
      if (deleted && snapshot.tasks.some(task => task.plan.projectId === project.id && (liveExecution(task.executionState) || task.lifecycle !== 'cancelled' && task.pendingCreation))) { setError('虚构示例：项目还有未结束执行或窗格创建待核对，未删除。'); return null; }
      setSnapshot(before => ({ ...before, projects: before.projects.map(item => item.id === project.id ? { ...item, deleted, revision: item.revision + 1 } : item) }));
      if (deleted && base.projectFilter === project.id) base.setProjectFilter('');
      notify(); return { objectId: project.id, revision: project.revision + 1, sequence: 0 };
    },
    workflow: { ...base.workflow,
      perform:async <T,>(_label:string,_work:()=>Promise<T>):Promise<T|null>=>{notify();return null;},
      launch: async () => { notify(); return null; },
      input: async <T,>(name: string, _label: string, payload: Record<string, unknown>): Promise<T | null> => {
        if (state==='task-panel-delivery-error' && name==='accept'){base.workflow.setError('虚构示例：代码版本已改变，请重新交付，验收没有保存。');return null;}
        if(name==='accept') {
          if(payload.accepted && snapshot.tasks.find(t=>t.id===payload.taskId)?.checkState!=='passed' && payload.acknowledgeUnverified!==true){base.workflow.setError('虚构示例：请确认按未验证结果验收。');return null;}
          setSnapshot(before=>({...before,tasks:before.tasks.map(t=>t.id===payload.taskId?{...t,acceptanceState:payload.accepted?'accepted':'rejected',lane:(payload.accepted?'done':'human') as TaskView['lane']}:t)}));notify();return 'fixture-acceptance' as unknown as T;
        }
        if(name==='check') {
          setSnapshot(before=>({...before,tasks:before.tasks.map(t=>t.id==='fixture-task-113'?{...t,checkState:'passed'}:t),evidence:[{id:'fixture-confirmed-check',taskId:'fixture-task-113',taskRevision:3,executionId:'fixture-run-113',kind:'check',level:'user_confirmed' as const,status:'passed',path:'C:/ui-fixture/check.log',hash:'fixture-only',snapshotId:'fixture-snapshot-113',createdAt:at,detail:{checkId:payload.checkId,command:payload.command,coverage:payload.coverage,exitCode:0}},...before.evidence]}));notify();return 'fixture-check' as unknown as T;
        }
        if (name === 'execution_action') {
          const run = snapshot.executions.find(r => r.id === payload.executionId);
          if (payload.action==='release_for_revision' && run) setSnapshot(p=>({...p,executions:p.executions.map(r=>r.id===run.id?{...r,state:'superseded'}:r),tasks:p.tasks.map(t=>t.id===run.taskId?{...t,executionState:null,stopPending:false}:t)}));
          if (run) setSnapshot(before => ({ ...before, tasks: before.tasks.map(t => t.id === run.taskId && payload.action === 'interrupt' ? { ...t, stopPending: true, reasonCodes: ['stop_pending'] } : t) }));
        }
        notify(); return null;
      },
      loadAccesses: async () => {},
      context: state === 'task-panel-context' || deliveryStates.includes(state) ? previewContext(snapshot) : base.workflow.context,
      goalOpen: state === 'task-panel-goal' || base.workflow.goalOpen,
      dispatchOpen: ['task-panel-dispatch','task-panel-context'].includes(state) || base.workflow.dispatchOpen,
      dispatchTaskId: ['task-panel-dispatch','task-panel-context'].includes(state) ? 'fixture-task-113' : base.workflow.dispatchTaskId,
      importOpen: state === 'task-panel-import' || base.workflow.importOpen,
      deliveryOpen: base.workflow.deliveryOpen,
      deliveryTaskId: base.workflow.deliveryTaskId,
      recoveryOpen: state === 'task-panel-recovery' || base.workflow.recoveryOpen,
      recovery: state === 'task-panel-recovery' ? { task: snapshot.tasks.find(t => t.number === 116)!, execution: { id: 'fixture-run', taskId: 'fixture-task-116', taskRevision: 3, contextId: 'fixture-context', bindingId: 'fixture-binding', bindingGeneration: 1, state: 'disconnected', attempt: 1, requestId: 'fixture-request', authorization: [], snapshotId: null, reason: '虚构的失联记录', createdAt: at, updatedAt: at }, files: [{ path: 'src/interpolation.ts', beforeHash: 'fixture-before', currentHash: 'fixture-after', change: 'modified', restorable: false, reason: '只保留哈希，未保存源文件原文；不能声称可直接恢复。' }], evidence: [], missing: ['UI 虚构恢复材料，不代表真实代码已运行或可回滚。'], currentFingerprint: 'fixture-fingerprint', preservedSources: [], affectedTasks: ['fixture-task-115'] } : base.workflow.recovery,
    },
    refresh: async () => { notify(); }, saveTask,
    saveProject: async () => { const d = base.projectDraft; const revision = (d.expectedRevision ?? 0) + 1; setSnapshot(before => ({ ...before, projects: [...before.projects.filter(p => p.id !== d.id), { id: d.id, name: d.name, summary: d.summary, repositoryIds: d.repositoryIds, revision, createdAt: at }] })); base.closeProject(false); base.setProjectFilter(d.id); notify(); return { objectId: d.id, revision, sequence: 0 }; },
    mutate: async (action, revision) => {
      if (state === 'error' || state === 'conflict') { setError('示例操作失败，输入已保留。'); return null; }
      if (action.type === 'lifecycle' || action.type === 'cancel_stopped_execution') {
        const current = snapshot.tasks.find(t => t.id === action.id);
        if (current?.revision !== revision) { setError('示例：任务版本已改变，请核对。'); return null; }
        if (action.type === 'lifecycle' && action.lifecycle === 'cancelled' && snapshot.executions.some(r => r.taskId === action.id && liveExecution(r.state))) { setError('示例：原执行尚未停止，请先核对。'); return null; }
        const lifecycle = (action.type === 'lifecycle' ? action.lifecycle : 'cancelled') as TaskView['lifecycle'];
        setSnapshot(before => ({ ...before, tasks: before.tasks.map<TaskView>(t => t.id === action.id ? { ...t, lifecycle, stopPending: false, revision: t.revision + 1, lane: lifecycle === 'active' && !t.pendingCreation ? 'ready' : 'human', reasonCodes: lifecycle === 'active' ? t.pendingCreation ? ['creation_pending'] : [] : [lifecycle], allowedActions: lifecycle === 'active' ? ['edit','context','bind','dispatch'] : ['edit','context'], executionState: action.type === 'cancel_stopped_execution' ? 'cancelled' : t.executionState } : t), executions: before.executions.map(r => action.type === 'cancel_stopped_execution' && r.id === action.executionId ? { ...r, state: 'cancelled' } : r) }));
      }
      if (action.type === 'apply_memory' || action.type === 'cancel_memory') setSnapshot(before => ({ ...before, memories: before.memories.map(m => m.id === action.id ? { ...m, status: action.type === 'apply_memory' ? 'active' : 'cancelled', revision: m.revision + 1 } : m) }));
      if (action.type === 'update_memory_draft') setSnapshot(before => ({ ...before, memories: before.memories.map(m => m.id === action.id ? { ...m, body: action.body, source: action.source, kind: action.kind, stale: false, revision: m.revision + 1 } : m) }));
      if (action.type === 'memory_draft') setSnapshot(before => ({ ...before, memories: [...before.memories, { ...action, projectId: action.projectId ?? before.tasks.find(t => t.id === action.taskId)?.plan.projectId, status: 'draft', baseTaskRevision: revision, revision: 1, createdAt: at, category: ['memory','pause'].includes(action.kind) ? 'reference' : 'decision', originLevel: 'user_confirmed', sourceRefs: [], stale: false }] }));
      notify(); return { objectId: 'id' in action ? action.id : 'fixture', revision: (revision ?? 0) + 1, sequence: 0 };
    },
    loadGraph: async input => { if(['task-panel-graph-loading','task-panel-graph-error'].includes(state))return; const next = previewGraph(visibleSnapshot, input); if (state === 'task-panel-graph-long') for (const node of next.nodes) node.label += ' · 很长的中文名称与文件定位'.repeat(8); if(state==='task-panel-graph-empty'){next.nodes=[];next.relations=[];next.totalNodes=0;next.hasMore=false;}setGraphLayer(input.layer);setGraph(next); },
    saveRepository: async () => { base.setIntake(before => ({ ...before, step: 2 })); notify(); return { path: 'C:\\ui-fixture\\repository', label: '虚构工作仓库', repositoryId: 'fixture-repository', projectId: 'fixture-project', dataDirectory: 'C:\\ui-fixture\\repository\\.azcine\\task-panel', skillPath: 'E:\\skills-manager\\archify', scope: ['.'], migration: '' }; },

  };
}

function previewContext(snapshot: PanelSnapshot): ContextPackage {
  const task = snapshot.tasks.find(t => t.id === 'fixture-task-113')!;
  return { id: 'fixture-context-preview', taskId: task.id, taskRevision: task.revision, graphRevision: 3, title: task.title, goal: task.goal, scope: task.scope, acceptanceCriteria: task.criteria, workspaceSnapshot: null, dependencies: [], decisions: snapshot.memories.filter(m => m.status === 'active'), references: snapshot.memories.filter(m => m.category === 'reference'), evidence: [], relatedFiles: [], impactCandidates: [], resumeSummary: '虚构示例：已定位候选文件，尚未实际修改。', sourceRefs: ['UI 总览虚构资料'], missingInformation: ['UI 虚构上下文，未读取真实目录或运行 Agent。'], hash: 'fixture-not-a-real-hash', project: snapshot.projects[0], plan: task.plan, omittedItems: 0 };
}

function previewGraph(snapshot: PanelSnapshot, input: GraphQuery): GraphView {
  if (input.layer === 'code') return previewCodeGraph();
  const selected = snapshot.tasks.filter(t => !input.projectId || t.plan.projectId === input.projectId);
  const projects = snapshot.projects.filter(p => !input.projectId || p.id === input.projectId);
  const nodes: GraphNode[] = selected.map(t => ({ id: t.id, repositoryId: t.repositoryId, kind: t.objectKind, label: t.title, path: '', symbol: '', evidenceLevel: 'fixture', sources: ['虚构资料'], stale: false }));
  nodes.push(...projects.map(p => ({ id: p.id, repositoryId: null, kind: 'project', label: p.name, path: '', symbol: '', evidenceLevel: 'fixture' as const, sources: ['虚构项目归属'], stale: false })));
  const relations: Relation[] = [...snapshot.relations];
  const link = (fromId: string, toId: string, kind: string) => relations.push({ id: 'fixture-' + fromId + '-' + toId, fromId, toId, kind, threshold: 'none', source: 'UI 虚构关系；不代表实际分析', evidenceLevel: 'fixture', active: true, revision: 1 });
  for (const task of selected) { if (task.plan.projectId) link(task.plan.goalId ?? task.plan.projectId, task.id, 'contains'); }
  if (projects.some(p => p.id === 'fixture-project')) {
    nodes.push({ id: 'fixture-file', repositoryId: 'fixture-repository', kind: 'file', label: 'interpolation.ts', path: 'src/interpolation.ts', symbol: '', evidenceLevel: 'fixture', sources: [{ path: 'src/interpolation.ts', lineStart: 12, sha256: 'fixture-not-a-real-hash' }], stale: false }, { id: 'fixture-symbol', repositoryId: 'fixture-repository', kind: 'symbol', label: 'interpolate', path: 'src/interpolation.ts', symbol: 'interpolate', evidenceLevel: 'fixture', sources: ['虚构声明定位'], stale: true });
    link('fixture-task-113', 'fixture-file', 'related_to'); link('fixture-file', 'fixture-symbol', 'contains');
  }
  const visible = nodes.filter(n => input.layer === 'code' ? ['file','symbol'].includes(n.kind) || n.id === input.taskId : input.layer === 'execution' ? !['file','symbol'].includes(n.kind) : true);
  const ids = new Set(visible.map(n => n.id));
  const graph = { graphRevision: 3, nodes: visible, relations: relations.filter(r => ids.has(r.fromId) && ids.has(r.toId)), totalNodes: visible.length, offset: 0, hasMore: false, coverage: ['UI 虚构业务图和代码图'], unknowns: ['UI 虚构图谱，不代表实际仓库已分析。'] };
  if (input.layer === 'execution') {
    const flow = taskFlowView(graph, selected.some(task => task.id === input.taskId && task.objectKind !== 'goal') ? input.taskId || null : null);
    return { ...flow, totalNodes: flow.nodes.length };
  }
  return graph;
}

function previewCodeGraph(): GraphView {
  const records = [
    ['ui-projects','项目页','component','app/src/projects-panels.tsx'],['ui-news','资讯阅读','component','app/src/news-reader-panels.tsx'],['ui-agent','Agent 页','component','app/src/pi-agent-panel.tsx'],['ui-tasks','任务面板','component','app/src/task-panel-panels.tsx'],
    ['api','桌面接口','interface','app/src/desktop-api.ts'],
    ['projects','项目服务','service','app/src-tauri/src/projects.rs'],['news','资讯管线','service','app/src-tauri/src/news-pipeline.rs'],['pi-service','Pi 进程管理','service','app/src-tauri/src/pi-manager.rs'],['tasks','任务存储','service','app/src-tauri/src/task-panel-store.rs'],['herdr-service','Herdr 适配器','service','app/src-tauri/src/herdr-adapter.rs'],
    ['db','SQLite','storage','db/fixture.sqlite3'],['pi','Pi RPC','external','虚构进程'],['rss','RSS / Atom','external','虚构来源'],['herdr','Herdr','external','虚构服务'],
  ];
  const nodes: GraphNode[] = records.map(([id,label,kind,path]) => ({ id:'fixture-code-'+id, label, kind, path, symbol:'', repositoryId:'fixture-repository', evidenceLevel:'fixture', stale:id==='tasks', sources:[{description:'UI 虚构结构，仅用于关系图展示，不代表仓库分析结论',path}] }));
  const links = [['ui-projects','api'],['ui-news','api'],['ui-agent','api'],['ui-tasks','api'],['api','projects'],['api','news'],['api','pi-service'],['api','tasks'],['api','herdr-service'],['projects','db'],['news','db'],['news','rss'],['pi-service','pi'],['tasks','db'],['herdr-service','herdr']];
  const relations: Relation[] = links.map(([from,to],i) => ({ id:'fixture-code-edge-'+i, fromId:'fixture-code-'+from, toId:'fixture-code-'+to, kind:'related_to', threshold:'none', source:'UI 虚构关系', evidenceLevel:'fixture', active:true, revision:1 }));
  return {graphRevision:3,nodes,relations,totalNodes:nodes.length,offset:0,hasMore:false,coverage:['UI 虚构代码结构'],unknowns:['UI 虚构图谱，不代表实际仓库已分析。']};
}
