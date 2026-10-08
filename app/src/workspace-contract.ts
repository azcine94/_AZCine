export interface Todo {
  id: string; title: string; dueDate: string | null; projectId: string | null;
  completed: boolean; revision: number; createdAt: string;
}
export interface Workspace { root: string | null; defaultRoot: string; todos: Todo[]; rootChangeNotice?: string | null }
export interface TodoInput { id: string; title: string; dueDate: string | null; projectId: string | null }
export type TodoFilter = 'incomplete' | 'today' | 'completed';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day > 0 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function invalid(): never { throw new Error('桌面返回的数据不完整，未替换现有记录。请重新读取后核对。'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
export function parseTodo(value: unknown): Todo {
  const t = object(value);
  if (typeof t.id !== 'string' || !uuid.test(t.id) || typeof t.title !== 'string' || !t.title.trim() || [...t.title].length > 500
    || !(t.dueDate === null || typeof t.dueDate === 'string' && validDate(t.dueDate))
    || !(t.projectId === null || typeof t.projectId === 'string' && uuid.test(t.projectId)) || typeof t.completed !== 'boolean'
    || !Number.isSafeInteger(t.revision) || Number(t.revision) < 1 || typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt))) return invalid();
  return { id: t.id, title: t.title, dueDate: t.dueDate, projectId: t.projectId, completed: t.completed, revision: t.revision as number, createdAt: t.createdAt };
}
export function parseWorkspace(value: unknown): Workspace {
  const w = object(value);
  if (!(w.root === null || typeof w.root === 'string' && w.root.length > 0) || typeof w.defaultRoot !== 'string' || !Array.isArray(w.todos)) return invalid();
  const todos = w.todos.map(parseTodo);
  if (new Set(todos.map(t => t.id)).size !== todos.length || w.root === null && todos.length !== 0) return invalid();
  if (w.rootChangeNotice != null && typeof w.rootChangeNotice !== 'string') return invalid();
  return { root: w.root, defaultRoot: w.defaultRoot, todos, ...(w.rootChangeNotice === undefined ? {} : { rootChangeNotice: w.rootChangeNotice as string | null }) };
}
export function validateTodo(title: string, date: string): string | null {
  if (!title.trim() || [...title.trim()].length > 500) return '请填写 1–500 字的待办标题。';
  if (date && !validDate(date)) return '请填写有效的完整日期，也可以不填。';
  return null;
}
export function localDate(now = new Date()): string {
  return `${now.getFullYear().toString().padStart(4,'0')}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
}
export function millisecondsToNextDay(now: Date): number {
  const midnight = new Date(now.getTime());
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
}
export function filterTodos(todos: Todo[], filter: TodoFilter, today = localDate()): Todo[] {
  return todos.filter(t => filter === 'completed' ? t.completed : !t.completed && (filter !== 'today' || t.dueDate === today))
    .sort((a,b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function workspaceError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '无法完成数据操作，输入已保留。请重新读取并核对后重试。';
}
export function sameInput(todo: Todo, input: TodoInput): boolean {
  return todo.id === input.id && todo.title === input.title && todo.dueDate === input.dueDate && todo.projectId === input.projectId;
}
