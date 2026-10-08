export interface IdeaContent { id: string; title: string; body: string; tags: string[]; projectId: string | null }
export interface Idea extends IdeaContent { revision: number; createdAt: string; updatedAt: string; deleted: boolean; todoId: string | null }
export interface IdeaDraft { title: string; body: string; tags: string; projectId: string; expectedRevision: number | null }
export interface SaveIdea { requestId: string; expectedRevision: number | null; content: IdeaContent }
export const emptyIdeaDraft = (): IdeaDraft => ({ title: '', body: '', tags: '', projectId: '', expectedRevision: null });
export const ideaDraft = (idea: Idea): IdeaDraft => ({ title: idea.title, body: idea.body, tags: idea.tags.join('，'), projectId: idea.projectId ?? '', expectedRevision: idea.revision });
export const splitTags = (value: string): string[] => value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
export function validateIdea(draft: IdeaDraft): string | null {
  if (!draft.body.trim() || [...draft.body].length > 20_000) return '请填写 1–20000 字的灵感内容。';
  if ([...draft.title].length > 200) return '标题最多 200 字，也可以不填。';
  const tags = splitTags(draft.tags);
  if (tags.length > 20 || tags.some(t => [...t].length > 40) || new Set(tags.map(t => t.toLowerCase())).size !== tags.length) return '最多 20 个标签，每个不超过 40 字，不能重复。';
  return null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw Error('灵感返回数据不完整，未替换已有记录。请重新读取核对。'); }
export function parseIdea(raw: unknown): Idea {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const i = raw as Record<string, unknown>;
  if (typeof i.id !== 'string' || !uuid.test(i.id) || typeof i.title !== 'string' || typeof i.body !== 'string'
    || !Array.isArray(i.tags) || !i.tags.every(t => typeof t === 'string' && t.trim() === t && !!t)
    || !(i.projectId === null || typeof i.projectId === 'string' && uuid.test(i.projectId))
    || !(i.todoId === null || typeof i.todoId === 'string' && uuid.test(i.todoId))
    || !Number.isSafeInteger(i.revision) || Number(i.revision) < 1 || typeof i.deleted !== 'boolean'
    || typeof i.createdAt !== 'string' || !Number.isFinite(Date.parse(i.createdAt))
    || typeof i.updatedAt !== 'string' || !Number.isFinite(Date.parse(i.updatedAt))) return invalid();
  const result = i as unknown as Idea;
  if (validateIdea(ideaDraft(result))) return invalid();
  return result;
}
export function parseIdeas(raw: unknown): Idea[] {
  if (!Array.isArray(raw)) return invalid();
  const ideas = raw.map(parseIdea);
  if (new Set(ideas.map(i => i.id)).size !== ideas.length) return invalid();
  return ideas;
}
export function contentFor(id: string, draft: IdeaDraft): IdeaContent {
  return { id, title: draft.title.trim(), body: draft.body.trim(), tags: splitTags(draft.tags), projectId: draft.projectId || null };
}
export function sameIdeaContent(a: IdeaContent, b: IdeaContent): boolean {
  return a.id === b.id && a.title === b.title && a.body === b.body && a.projectId === b.projectId && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}
export function filterIdeas(ideas: Idea[], query: string, tag: string, projectId: string, deleted: boolean): Idea[] {
  const needle = query.trim().toLocaleLowerCase();
  return ideas.filter(i => i.deleted === deleted && (!tag || i.tags.includes(tag)) && (!projectId || i.projectId === projectId)
    && (!needle || [i.title, i.body, ...i.tags].join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function ideaTitle(idea: Idea): string { return idea.title || idea.body.split('\n')[0].slice(0, 80); }
