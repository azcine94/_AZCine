import { notifyOperation, useOperationNotices } from './components/ui/operation-toast.tsx';
// Project drafts and pending saves survive routed page changes at App scope.
import { useEffect, useRef, useState } from 'react';
import { invoke } from './desktop-api.ts';
import { parseProject, parseProjectCatalog, parseProjectDeletionReceipt, parseProjectContent } from './projects-contract.ts';
import type { ProjectContent, ProjectDocument, ProjectUndo, ProjectDeletionRequest, ProjectDeletionReceipt } from './projects-contract.ts';
import { workspaceError } from './workspace-contract.ts';

export interface ProjectSaveRequest { requestId: string; expectedRevision: number | null; document: ProjectContent }
export interface ProjectDraft { content: ProjectContent; baseline: number | null; dirty: boolean; undoApplied?: boolean }
interface PendingSave { request: ProjectSaveRequest; consumesUndo: boolean }
function contentOf(doc: ProjectContent): ProjectContent {
  return structuredClone({ id: doc.id, name: doc.name, labels: doc.labels, blocks: doc.blocks });
}
function equalContent(a: ProjectContent, b: ProjectContent): boolean {
  // Cell maps may have different insertion order after Rust's BTreeMap round-trip.
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, ordered(v)]));
    return value;
  }
  return JSON.stringify(ordered(contentOf(a))) === JSON.stringify(ordered(contentOf(b)));
}
export function useProjects(root: string | null) {
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const projectsRef = useRef<ProjectDocument[]>([]);
  const [removedProjects, setRemovedProjects] = useState<ProjectDocument[]>([]);
  const removedRef = useRef<ProjectDocument[]>([]);
  const [deletionPending, setDeletionPending] = useState<Record<string, ProjectDeletionRequest>>({});
  const deletionRef = useRef<Record<string, ProjectDeletionRequest>>({});
  const [lastDeleted, setLastDeleted] = useState<ProjectDocument | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({});
  const draftsRef = useRef<Record<string, ProjectDraft>>({});
  const [pending, setPending] = useState<Record<string, PendingSave>>({});
  const pendingRef = useRef<Record<string, PendingSave>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useOperationNotices<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const busyIdRef = useRef('');
  const queuedSave = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const newNameRef = useRef('');
  const [newId, setNewId] = useState<string | null>(null);
  const newIdRef = useRef<string | null>(null);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  // The domain's local undo object is kept by the page-independent controller.
  const [undos, setUndos] = useState<Record<string, ProjectUndo>>({});
  const undosRef = useRef<Record<string, ProjectUndo>>({});
  const loadedRoot = useRef<string | null>(null);

  function putDraft(id: string, draft: ProjectDraft) {
    draftsRef.current = { ...draftsRef.current, [id]: draft }; setDrafts(draftsRef.current);
  }
  function putPending(id: string, value: PendingSave | null) {
    const next = { ...pendingRef.current };
    if (value) next[id] = value; else delete next[id];
    pendingRef.current = next; setPending(next);
  }
  function putUndo(id: string, undo: ProjectUndo | null) {
    const next = { ...undosRef.current };
    if (undo == null) delete next[id]; else next[id] = undo;
    undosRef.current = next; setUndos(next);
    const draft = draftsRef.current[id];
    if (draft?.undoApplied) putDraft(id, { ...draft, undoApplied: false });
  }
  function message(id: string, error = '', notice = '') {
    setErrors(previous => ({ ...previous, [id]: error }));
    setNotices(previous => ({ ...previous, [id]: notice }));
  }
  function acceptProjects(next: ProjectDocument[]) {
    projectsRef.current = next; setProjects(next); setLoadError('');
    const nextDrafts = { ...draftsRef.current };
    for (const doc of next) {
      const previous = nextDrafts[doc.id];
      if (!previous || !previous.dirty && !pendingRef.current[doc.id]) {
        nextDrafts[doc.id] = { content: contentOf(doc), baseline: doc.revision, dirty: false };
      }
    }
    draftsRef.current = nextDrafts; setDrafts(nextDrafts);
  }
  function acceptSaved(doc: ProjectDocument) {
    const previous = projectsRef.current;
    acceptProjects(previous.some(item => item.id === doc.id) ? previous.map(item => item.id === doc.id ? doc : item) : [...previous, doc]);
  }
  async function readAll() {
    const catalog = parseProjectCatalog(await invoke<unknown>('project_catalog'));
    removedRef.current = catalog.removed; setRemovedProjects(catalog.removed);
    acceptProjects(catalog.projects); return catalog.projects;
  }
  async function refresh() {
    if (!root || busyRef.current) return;
    busyRef.current = true; setLoading(true);
    try { await readAll(); } catch (error) { setLoadError(workspaceError(error)); }
    finally { busyRef.current = false; setLoading(false); }
  }
  useEffect(() => {
    if (root && loadedRoot.current !== root) { loadedRoot.current = root; void refresh(); }
  });
  async function action(id: string, work: () => Promise<void>) {
    if (!root || busyRef.current) return;
    busyRef.current = true; busyIdRef.current = id; setBusy(id); message(id);
    let succeeded = false;
    try { await work(); succeeded = true; }
    catch (error) { message(id, workspaceError(error)); }
    finally {
      busyRef.current = false; busyIdRef.current = ''; setBusy('');
      const queued = queuedSave.current; queuedSave.current = null;
      if (succeeded && queued && draftsRef.current[queued]?.dirty && !pendingRef.current[queued]) void save(queued);
    }
  }
  function changeNewName(value: string) {
    if (busyRef.current || newIdRef.current) return;
    newNameRef.current = value; setNewName(value);
  }
  function change(id: string, update: (content: ProjectContent) => ProjectContent, validateCandidate = false) {
    if (busyRef.current && (busyIdRef.current !== id || validateCandidate) || pendingRef.current[id] && busyIdRef.current !== id) return false;
    if (deletionRef.current[id] || removedRef.current.some(project => project.id === id)) return false;
    const draft = draftsRef.current[id]; if (!draft) return false;
    try {
      const content = update(contentOf(draft.content));
      if (content.id !== id) throw new Error('不能在编辑时改变项目编号。');
      // Structural changes are atomic in memory too. A rejected addition must
      // not poison an otherwise editable draft or discard its earlier text.
      if (validateCandidate) parseProjectContent(content);
      putDraft(id, { ...draft, content, dirty: true }); message(id); return true;
    } catch (error) { message(id, workspaceError(error)); return false; }
  }
  function validateReceipt(id: string, doc: ProjectDocument, request: PendingSave) {
    const expected = request.request.expectedRevision === null ? 1 : request.request.expectedRevision + 1;
    if (doc.id !== id || doc.revision !== expected || !equalContent(doc, request.request.document)) throw new Error('项目保存响应不对应本次请求，草稿已保留，请重新核对保存结果。');
  }
  function finishSave(id: string, receipt: ProjectDocument, request: PendingSave, latest = receipt) {
    validateReceipt(id, receipt, request);
    if (latest.id !== id || latest.revision < receipt.revision) throw new Error('原请求已确认，但最新正式记录尚未确认；草稿和请求仍保留。');
    // A receipt confirms a historical write, never downgrades known official data.
    const known = projectsRef.current.find(item => item.id === id);
    const official = known && known.revision > latest.revision ? known : latest;
    const current = draftsRef.current[id];
    const editedDuringSave = current && !equalContent(current.content, request.request.document);
    acceptSaved(official);
    putDraft(id, { content: editedDuringSave ? current.content : contentOf(official), baseline: editedDuringSave ? receipt.revision : official.revision, dirty: !!editedDuringSave, undoApplied: request.consumesUndo ? false : current?.undoApplied });
    putPending(id, null);
    if (request.consumesUndo) putUndo(id, null);
    if (newIdRef.current === id) { newIdRef.current = null; setNewId(null); newNameRef.current = ''; setNewName(''); }
    message(id, '', request.consumesUndo ? '已恢复删除的内容，其他编辑保持不变。' : '项目已保存。');
  }
  async function saveInside(id: string, consumesUndo = false) {
    if (deletionRef.current[id] || removedRef.current.some(project => project.id === id)) throw new Error('项目已删除或操作结果待核对，草稿保留，请先恢复或核对。');
    let draft = draftsRef.current[id]; if (!draft) throw new Error('项目草稿不存在，请重新读取。');
    if (!draft.dirty && !pendingRef.current[id]) return;
    // The restore intent lives with the draft, not just a disposable request.
    if (consumesUndo && !draft.undoApplied) { draft = { ...draft, undoApplied: true }; putDraft(id, draft); }
    let request = pendingRef.current[id];
    const retry = !!request;
    if (!request) {
      // Validate before freezing an immutable request; invalid input stays editable.
      parseProjectContent(draft.content);
      request = { request: { requestId: crypto.randomUUID(), expectedRevision: draft.baseline, document: contentOf(draft.content) }, consumesUndo: !!draft.undoApplied };
      putPending(id, request);
    }
    try {
      const doc = parseProject(await invoke<unknown>('save_project', { input: request.request }));
      validateReceipt(id, doc, request);
      const latest = retry ? (await readAll()).find(item => item.id === id) : doc;
      if (!latest) throw new Error('已确认原请求，但未能读取最新项目；输入和请求保留，请再次核对。');
      finishSave(id, doc, request, latest);
    } catch (error) {
      // A definitive stale request still retains its exact payload until the user
      // checks the durable receipt and compares the current official document.
      throw error;
    }
  }
  function save(id: string, consumesUndo = false): Promise<void> {
    if (busyRef.current && busyIdRef.current === id) { queuedSave.current = id; return Promise.resolve(); }
    return action(id, () => saveInside(id, consumesUndo));
  }
  const create = async () => {
    let created: string | null = null;
    await action('create', async () => {
      const name = newNameRef.current.trim();
      if (!name || [...name].length > 200) throw new Error('请填写 1–200 字的公司项目名称。');
      let id = newIdRef.current;
      if (!id) {
        id = crypto.randomUUID(); newIdRef.current = id; setNewId(id);
        putDraft(id, { content: { id, name, labels: [], blocks: [] }, baseline: null, dirty: true });
      }
      await saveInside(id);
      created = id;
      message('create', '', '公司项目已创建，可打开文档。');
    });
    return created;
  };
  const reconcile = (id: string) => action(id, async () => {
    const request = pendingRef.current[id]; if (!request) return;
    const raw = await invoke<unknown>('project_request', { requestId: request.request.requestId });
    if (raw !== null) {
      const saved = parseProject(raw);
      validateReceipt(id, saved, request);
      // Read before accepting or clearing pending: failure must not publish an
      // old receipt as the latest document or silently unfreeze uncertain input.
      const latest = (await readAll()).find(item => item.id === id);
      if (!latest) throw new Error('已确认原请求，但未能读取最新项目；输入和请求保留，请再次核对。');
      finishSave(id, saved, request, latest);
      message(id, '', '已核对原保存请求，没有重复创建；正式记录已重新读取。');
    } else {
      await readAll(); putPending(id, null);
      if (newIdRef.current === id) {
        newIdRef.current = null; setNewId(null);
        // Preserve the name; the unused in-memory candidate is not a formal project.
      }
      message(id, '', '已确认该请求没有保存。草稿保留，可修改后重试；若正式修订已变，请先核对下方版本。');
    }
  });
  function putDeletion(id: string, request: ProjectDeletionRequest | null) {
    const next = { ...deletionRef.current };
    if (request) next[id] = request; else delete next[id];
    deletionRef.current = next; setDeletionPending(next);
  }
  function checkDeletion(receipt: ProjectDeletionReceipt, request: ProjectDeletionRequest) {
    if (receipt.requestId !== request.requestId || receipt.deleted !== request.deleted || receipt.project.id !== request.projectId || receipt.project.revision !== request.expectedRevision + 1) {
      throw new Error('项目操作回执不对应本次请求，请核对；原请求及草稿已保留。');
    }
  }
  async function finishDeletion(receipt: ProjectDeletionReceipt, request: ProjectDeletionRequest) {
    checkDeletion(receipt, request);
    await readAll();
    const current = (request.deleted ? removedRef.current : projectsRef.current).find(item => item.id === request.projectId);
    const matches = !!current && current.revision >= receipt.project.revision;
    putDeletion(request.projectId, null);
    if (request.deleted && matches) setLastDeleted(current);
    else setLastDeleted(previous => previous?.id === request.projectId ? null : previous);
    message(`delete:${request.projectId}`, '', matches ? request.deleted ? '项目已删除，可撤销或到“已删除”恢复。' : '项目已恢复。' : '原操作已执行，当前状态随后有变化，请按最新列表核对。');
    if (request.deleted && matches && current) notifyOperation(`已删除“${current.name}”`, { tone: 'success', action: { label: '撤销', run: () => setDeleted(current, false) } });
    return matches;
  }
  async function setDeleted(project: ProjectDocument, deleted: boolean): Promise<boolean> {
    let success = false;
    await action(`delete:${project.id}`, async () => {
      if (pendingRef.current[project.id]) throw new Error('此项目的保存结果尚未确认，请先核对保存结果。');
      let request = deletionRef.current[project.id];
      if (request && request.deleted !== deleted) throw new Error('前次删除或恢复结果尚未确认，请先核对，原请求已保留。');
      if (!request) {
        request = { requestId: crypto.randomUUID(), projectId: project.id, expectedRevision: project.revision, deleted };
        putDeletion(project.id, request);
      }
      try {
        const receipt = parseProjectDeletionReceipt(await invoke<unknown>('set_project_deleted', { input: request }));
        success = await finishDeletion(receipt, request);
      } catch (error) {
        // Only a definitive rejection permits a new request. Transport failures
        // retain the exact request so retry cannot repeat a completed mutation.
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (['stale_record', 'project_missing', 'invalid_id', 'invalid_project_content'].includes(String(code))) {
          await readAll(); putDeletion(project.id, null);
        }
        throw error;
      }
    });
    return success;
  }
  const reconcileDeletion = (id: string) => action(`delete:${id}`, async () => {
    const request = deletionRef.current[id]; if (!request) return;
    const raw = await invoke<unknown>('project_deletion_request', { requestId: request.requestId });
    if (raw === null) {
      await readAll(); putDeletion(id, null);
      message(`delete:${id}`, '', '已确认原请求未执行，可重新操作。草稿已保留。');
    } else await finishDeletion(parseProjectDeletionReceipt(raw), request);
  });
  // Explicit, informed rebase only. Neither refresh nor a stale response does it.
  function rebase(id: string) {
    if (busyRef.current || pendingRef.current[id]) return;
    const official = projectsRef.current.find(doc => doc.id === id), draft = draftsRef.current[id];
    if (!official || !draft) return;
    putDraft(id, { ...draft, baseline: official.revision, dirty: true });
    message(id, '', '已确认以当前正式修订为基线，草稿仍未保存。请检查后点击保存。');
  }
  function changeLabelDraft(id: string, value: string, labelId?: string) {
    if (!busyRef.current && !pendingRef.current[id]) setLabelDrafts(previous => ({ ...previous, [labelId ? `${id}/${labelId}` : id]: value }));
  }
  function replaceWithOfficial(id: string) {
    if (busyRef.current || pendingRef.current[id]) return;
    const official = projectsRef.current.find(doc => doc.id === id); if (!official) return;
    // Invoked only from an explicit discard confirmation in the page.
    putDraft(id, { content: contentOf(official), baseline: official.revision, dirty: false });
    message(id, '', '已采用正式记录。');
  }
  return { projects, removedProjects, deletionPending, lastDeleted, setDeleted, reconcileDeletion, drafts, pending, errors, notices, loading:loading||Boolean(root&&loadedRoot.current!==root), loadError, busy, newName, newId, undos, labelDrafts, query,
    changeQuery: setQuery, changeNewName, refresh, change, save, create, reconcile, rebase, replaceWithOfficial, putUndo, changeLabelDraft };
}
export type ProjectsController = ReturnType<typeof useProjects>;
