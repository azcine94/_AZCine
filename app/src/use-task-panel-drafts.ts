import { useEffect, useRef, useState } from 'react';
import { isTauri } from './desktop-api.ts';
import { taskPanelClient } from './task-panel-client.ts';
import { taskError } from './task-panel-contract.ts';
import type { TaskDraft } from './task-panel-contract.ts';

const validDraft = (value: unknown): value is TaskDraft => {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<TaskDraft>;
  return typeof d.id === 'string' && (d.expectedRevision === null || typeof d.expectedRevision === 'number')
    && ['title', 'goal', 'scope', 'criteria', 'repositoryId', 'projectId', 'goalId', 'phase', 'source'].every(key => typeof (d as unknown as Record<string, unknown>)[key] === 'string');
};

/** Each repository persists its own drafts through Rust. Queue writes so a
 * delayed keystroke cannot resurrect a draft cleared after successful saving. */
export function useTaskPanelDrafts(enabled: boolean) {
  const drafts = useRef<Record<string, TaskDraft>>({});
  const queue = useRef(Promise.resolve());
  const alive = useRef(true), root = useRef<string | null>(null), pending = useRef(0);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const key = (workspace: string | null, id: string) => `${workspace}:${id}`;
  async function load(workspace: string) {
    root.current = workspace; setError('');
    if (!enabled || !isTauri()) return;
    try {
      const values = await taskPanelClient(workspace).drafts();
      const ordered=Object.values(values).sort((a,b)=>String((b as Record<string,unknown>)?.draftSavedAt || '').localeCompare(String((a as Record<string,unknown>)?.draftSavedAt || '')));
      for (const value of ordered) if (validDraft(value)) {
        // Never overwrite input typed while the load was in flight.
        const restored = { ...value, autoStart: false };
        drafts.current[key(workspace, value.id)] ??= restored;
        if (!value.feedbackOnly && value.expectedRevision === null) drafts.current[key(workspace, 'new')] ??= restored;
      }
    } catch (e) { if (alive.current && root.current === workspace) setError(`草案恢复失败，现有输入保留：${taskError(e)}`); }
  }
  function write(workspace: string | null, id: string, draft: TaskDraft | null) {
    if (!enabled || !workspace || !isTauri()) return;
    pending.current++; if (alive.current) setSaving(true);
    queue.current = queue.current.then(async () => {
      try { await taskPanelClient(workspace).saveDraft(id, draft); if (alive.current && root.current === workspace) setError(''); }
      catch (e) { if (alive.current && root.current === workspace) setError(`草案尚未落盘，输入保留在窗口中：${taskError(e)}`); }
      finally { pending.current--; if (alive.current) setSaving(pending.current > 0); }
    });
  }
  function remember(workspace: string | null, value: TaskDraft) {
    drafts.current[key(workspace, value.id)] = value;
    if (!value.feedbackOnly && value.expectedRevision === null) drafts.current[key(workspace, 'new')] = value;
    else if (drafts.current[key(workspace, 'new')]?.id === value.id) delete drafts.current[key(workspace, 'new')];
    write(workspace, value.id, { ...value });
  }
  function forget(workspace: string | null, id: string) {
    delete drafts.current[key(workspace, id)];
    if (drafts.current[key(workspace, 'new')]?.id === id) delete drafts.current[key(workspace, 'new')];
    write(workspace, id, null);
  }
  return { drafts, key, load, remember, forget, error, saving };
}
