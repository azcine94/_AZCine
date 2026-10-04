import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { contentFor, emptyIdeaDraft, ideaDraft, parseIdea, parseIdeas, sameIdeaContent, validateIdea } from './ideas-contract.ts';
import type { Idea, IdeaDraft, SaveIdea } from './ideas-contract.ts';
import { workspaceError } from './workspace-contract.ts';

// This controller belongs to App: route, card and theme changes preserve all drafts.
export function useIdeas(root: string | null) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const ideaRef = useRef<Idea[]>([]);
  const [drafts, setDrafts] = useState<Record<string, IdeaDraft>>({ new: emptyIdeaDraft() });
  const draftRef = useRef(drafts);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, SaveIdea>>({});
  const requests = useRef<Record<string, SaveIdea>>({});
  const [busy, setBusy] = useState('');
  const locked = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<Idea | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [projectId, setProjectId] = useState('');
  const [deleted, setDeleted] = useState(false);
  const generation = useRef(0);
  function putDraft(key: string, value: IdeaDraft) { draftRef.current = { ...draftRef.current, [key]: value }; setDrafts(draftRef.current); }
  function changeDraft(key: string, field: 'title' | 'body' | 'tags' | 'projectId', value: string) {
    putDraft(key, { ...(draftRef.current[key] ?? emptyIdeaDraft()), [field]: value });
  }
  function edit(idea: Idea) {
    if (Object.values(requests.current).some(r => r.content.id === idea.id)) { setError('这张卡的保存结果尚未确认，请先核对保存结果。'); return; }
    if (!draftRef.current[idea.id]) putDraft(idea.id, ideaDraft(idea));
    setEditing(previous => ({ ...previous, [idea.id]: true }));
  }
  function accept(idea: Idea) {
    ideaRef.current = [...ideaRef.current.filter(i => i.id !== idea.id), idea];
    setIdeas(previous => [...previous.filter(i => i.id !== idea.id), idea]);
  }
  function acceptList(next: Idea[]) {
    for (const idea of next) {
      const previous = ideaRef.current.find(i => i.id === idea.id), draft = draftRef.current[idea.id];
      // Deleted/todo flags may change after an uncertain mutation. Rebase only
      // when the formal content is identical and the draft used that exact base.
      if (previous && draft && draft.expectedRevision === previous.revision && sameIdeaContent(previous,idea)) putDraft(idea.id,{...draft,expectedRevision:idea.revision});
    }
    ideaRef.current = next; setIdeas(next);
  }
  async function refresh() {
    if (!root || !isTauri() || locked.current) return;
    const current = generation.current;
    locked.current = true; setLoading(true);
    try { const next = parseIdeas(await invoke('list_ideas')); if (current === generation.current) { acceptList(next); setLoadError(''); } }
    catch (e) { if (current === generation.current) setLoadError(workspaceError(e)); }
    finally { if (current === generation.current) { locked.current = false; setLoading(false); } }
  }
  useEffect(() => {
    generation.current++; locked.current = false;
    setIdeas([]); ideaRef.current=[]; setError(''); setLoadError(''); setNotice(''); setUndo(null); setEditing({}); setBusy(''); setLoading(false);
    requests.current = {}; setPending({}); draftRef.current = { new: emptyIdeaDraft() }; setDrafts(draftRef.current);
    void refresh();
  }, [root]);
  async function action(name: string, work: () => Promise<void>) {
    if (!root || locked.current || !isTauri()) return;
    const current = generation.current;
    locked.current = true; setBusy(name); setNotice('');
    try { await work(); if (current === generation.current) setError(''); }
    catch (e) { if (current === generation.current) setError(workspaceError(e)); }
    finally { if (current === generation.current) { locked.current = false; setBusy(''); } }
  }
  function release(key: string) { delete requests.current[key]; setPending({ ...requests.current }); }
  const save = (key: string) => action(`save:${key}`, async () => {
    const draft = draftRef.current[key];
    if (!draft) return;
    if (!requests.current[key]) { const problem = validateIdea(draft); if (problem) throw Error(problem); }
    if (key !== 'new' && Object.entries(requests.current).some(([k,r]) => k !== key && r.content.id === key)) throw Error('这张卡的原保存结果尚未确认，请先核对。');
    const input = requests.current[key] ?? { requestId: crypto.randomUUID(), expectedRevision: draft.expectedRevision, content: contentFor(key === 'new' ? crypto.randomUUID() : key, draft) };
    requests.current[key] = input;
    const snapshot = JSON.stringify(draft);
    try {
      const saved = parseIdea(await invoke('save_idea', { input }));
      if (!sameIdeaContent(saved, input.content) || saved.revision !== (input.expectedRevision ?? 0) + 1 || saved.deleted) throw Error('保存回执与输入不一致，请重新读取核对。');
      const latest = parseIdeas(await invoke('list_ideas'));
      const current = latest.find(i => i.id === saved.id);
      if (!current || current.revision !== saved.revision || !sameIdeaContent(current,saved) || current.deleted) { acceptList(latest); throw Error('这次保存已被后续修改替代，原草稿保留，请核对当前记录。'); }
      accept(saved); release(key);
      // A response only confirms the submitted version; later typing stays intact.
      if (sameIdeaContent(contentFor(saved.id, draftRef.current[key]), input.content) && JSON.stringify(draftRef.current[key]) === snapshot) {
        putDraft(key, key === 'new' ? emptyIdeaDraft() : ideaDraft(saved));
        if (key !== 'new') setEditing(previous => ({ ...previous, [key]: false }));
      } else if (key === 'new') {
        putDraft(saved.id, { ...draftRef.current.new, expectedRevision: saved.revision });
        putDraft('new', emptyIdeaDraft()); setEditing(previous => ({ ...previous, [saved.id]: true }));
      } else putDraft(key, { ...draftRef.current[key], expectedRevision: saved.revision });
      setNotice('灵感已保存。');
    } catch (e) { setPending({ ...requests.current }); throw e; }
  });
  const reconcile = (key: string) => action(`reconcile:${key}`, async () => {
    const request = requests.current[key]; if (!request) return;
    const all = parseIdeas(await invoke('list_ideas')); acceptList(all); setLoadError('');
    const raw = await invoke('idea_request', { requestId: request.requestId });
    const receipt = raw === null ? null : parseIdea(raw);
    if (receipt && (!sameIdeaContent(receipt, request.content) || receipt.revision !== (request.expectedRevision ?? 0) + 1)) throw Error('原保存回执与输入不一致，请保留草稿并核对。');
    const saved = all.find(i => i.id === request.content.id);
    if (receipt && saved && sameIdeaContent(saved, request.content) && saved.revision === receipt.revision && !saved.deleted) {
      if (sameIdeaContent(contentFor(saved.id, draftRef.current[key]), request.content)) putDraft(key, key === 'new' ? emptyIdeaDraft() : ideaDraft(saved));
      else if (key === 'new') { putDraft(saved.id, { ...draftRef.current.new, expectedRevision: saved.revision }); putDraft('new', emptyIdeaDraft()); setEditing(previous => ({ ...previous, [saved.id]: true })); }
      else putDraft(key, { ...draftRef.current[key], expectedRevision: saved.revision });
      setNotice('已确认保存成功，没有重复创建。');
    } else if (receipt) {
      if (key === 'new' && saved) { putDraft(saved.id, { ...draftRef.current.new, expectedRevision: receipt.revision }); putDraft('new',emptyIdeaDraft()); setEditing(previous=>({...previous,[saved.id]:true})); }
      setNotice('已确认原保存成功；记录之后有变化，编辑草稿保留，请核对当前版本。');
    } else setNotice('已确认这次修改未保存，草稿保留；记录有变化时请先核对当前版本。');
    release(key);
  });
  function continueOnCurrent(idea: Idea) {
    if (Object.values(requests.current).some(r => r.content.id === idea.id)) { setError('请先核对原保存结果。'); return; }
    const draft = draftRef.current[idea.id];
    if (draft) { putDraft(idea.id,{...draft,expectedRevision:idea.revision}); setNotice('已保留编辑草稿并采用当前版本作为基线，尚未保存。'); setError(''); }
  }
  function rebaseOwnMutation(idea: Idea) {
    const draft = draftRef.current[idea.id];
    if (draft && draft.expectedRevision === idea.revision - 1) putDraft(idea.id, { ...draft, expectedRevision: idea.revision });
  }
  const remove = (idea: Idea, nextDeleted: boolean) => action(`delete:${idea.id}`, async () => {
    if (Object.values(requests.current).some(r => r.content.id === idea.id)) throw Error('这张卡的保存结果尚未确认，请先核对保存结果。');
    const saved = parseIdea(await invoke('set_idea_deleted', { id: idea.id, revision: idea.revision, deleted: nextDeleted }));
    if (saved.id !== idea.id || saved.deleted !== nextDeleted || saved.revision !== idea.revision + 1 || !sameIdeaContent(saved,idea)) throw Error('移除回执不匹配，请重新读取核对。');
    accept(saved); rebaseOwnMutation(saved); setUndo(nextDeleted ? saved : null);
    setNotice(nextDeleted ? '已移除灵感，可以撤销。' : '灵感已恢复。');
  });
  const convert = (idea: Idea, refreshWorkspace: () => Promise<void>) => action(`convert:${idea.id}`, async () => {
    if (Object.values(requests.current).some(r => r.content.id === idea.id)) throw Error('请先核对这张卡的保存结果。');
    const saved = parseIdea(await invoke('convert_idea', { id: idea.id, revision: idea.revision }));
    if (saved.id !== idea.id || !saved.todoId || saved.deleted || !sameIdeaContent(saved,idea)) throw Error('转换回执不匹配，请重新读取核对。');
    accept(saved); rebaseOwnMutation(saved); setNotice('已转为待办，原灵感保留；未设置日期。');
    await refreshWorkspace();
  });
  function clearFilters() { setQuery(''); setTag(''); setProjectId(''); setDeleted(false); }
  return { ideas, drafts, changeDraft, editing, edit, closeEdit: (id: string) => setEditing(previous => ({ ...previous, [id]: false })),
    pending, busy, loading, error, loadError, notice, undo, refresh, save, reconcile, remove, convert,
    query, setQuery, tag, setTag, projectId, setProjectId, deleted, setDeleted, clearFilters, continueOnCurrent };
}
export type IdeasController = ReturnType<typeof useIdeas>;
