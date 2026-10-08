import { invoke } from './desktop-api.ts';
import type { AgentAccess, ContextPackage, GraphQuery, GraphView, HerdrCapabilities, HerdrConfig, HerdrSession, ImportPreview, MutationReceipt, PanelSnapshot, RecoveryPreview, TaskDraft, TaskMutation } from './task-panel-contract.ts';

export interface TaskWorkspaceEntry { path: string; label: string }
export interface OpenedTaskWorkspace extends TaskWorkspaceEntry { repositoryId: string; projectId: string | null; dataDirectory: string; skillPath: string; scope: string[]; migration: string }
export const taskWorkspaceClient = {
  list: () => invoke<TaskWorkspaceEntry[]>('task_panel_workspaces'),
  open: (path: string, label: string, scope: string[], configure = false) => invoke<OpenedTaskWorkspace>('task_panel_workspace_open', { input: { path, label, scope, configure } }),
};
export function taskPanelClient(workspace: string | null) {
  function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!workspace) return Promise.reject(new Error('请先选择仓库，任务将保存在该仓库的 .azcine 中。'));
    return invoke<T>(command, { ...args, workspace });
  }
  return {
  list: () => call<PanelSnapshot>('task_panel_list'),
  drafts: () => call<Record<string, TaskDraft>>('task_panel_drafts'),
  saveDraft: (id: string, draft: TaskDraft | null) => call<void>('task_panel_draft', { input: { id, draft } }),
  accesses: () => call<AgentAccess[]>('task_panel_agent_accesses'),
  mutate: (requestId: string, expectedRevision: number | null, action: TaskMutation) => call<MutationReceipt>('task_panel_mutate', { input: { requestId, expectedRevision, action } }),
  graph: (input: GraphQuery) => call<GraphView>('task_panel_graph', { input }),
  input: <T>(name: string, input: Record<string, unknown>) => call<T>(`task_panel_${name}`, { input }),
  contextGet: (id: string) => call<ContextPackage>('task_panel_context_get', { id }),
  imports: () => call<ImportPreview[]>('task_panel_imports'),
  herdrConfig: () => call<HerdrConfig>('task_panel_herdr_config'),
  saveHerdrConfig: (config: HerdrConfig) => call<HerdrConfig>('task_panel_herdr_config_save', { config }),
  herdrStatus: () => call<HerdrCapabilities>('task_panel_herdr_status'),
  sessions: () => call<HerdrSession[]>('task_panel_herdr_sessions'),
  focus: (bindingId: string) => call<void>('task_panel_focus', { bindingId }),
  focusCreation: (taskId: string) => call<void>('task_panel_focus', { taskId }),
  recovery: (executionId: string) => call<RecoveryPreview>('task_panel_recovery', { executionId }),
};
}
