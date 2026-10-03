// Parent-reviewed and completed after a truncated candidate; see s02-progress.
import { validDate } from './workspace-contract.ts';

export interface StageLabel { id: string; name: string }
export type ColumnKind = 'text' | 'shot' | 'stage' | 'date' | 'delivered';
export interface ListColumn { id: string; name: string; kind: ColumnKind; width?: number }
export const LIST_MIN_WIDTH = 112;
export const LIST_MAX_WIDTH = 640;
export interface ListRow { id: string; cells: Record<string, string> }
export interface TextBlock { id: string; kind: 'text'; title: string; body: string }
export interface ChecklistItem { id: string; text: string; checked: boolean }
export interface ChecklistBlock {
  id: string; kind: 'checklist'; title: string; items: ChecklistItem[];
}
export interface ListBlock {
  id: string; kind: 'list'; title: string; included: boolean;
  columns: ListColumn[]; rows: ListRow[];
}
export type ProjectBlock = TextBlock | ChecklistBlock | ListBlock;
export interface ProjectContent {
  id: string; name: string; labels: StageLabel[]; blocks: ProjectBlock[];
}
export interface ProjectDocument extends ProjectContent {
  revision: number; createdAt: string;
}
export interface ProjectSaveInput {
  requestId: string; expectedRevision: number | null; document: ProjectContent;
}
export type DeliveryKind = Exclude<ColumnKind, 'text'>;
export type DeliveryColumnIds = Record<DeliveryKind, string>;
export type DeliveryField = 'shot' | 'stageId' | 'dueDate';
export interface Delivery {
  projectId: string; projectName: string; blockId: string; blockTitle: string;
  rowId: string; shot: string; stageId: string; stageName: string;
  dueDate: string; missing: DeliveryField[];
}
export interface UndoPosition { beforeId: string | null; afterId: string | null }
interface UndoBase { projectId: string; position: UndoPosition }
export type ProjectUndo =
  | (UndoBase & { kind: 'block'; block: ProjectBlock })
  | (UndoBase & { kind: 'checklist-item'; blockId: string; item: ChecklistItem })
  | (UndoBase & {
      kind: 'row'; blockId: string; row: ListRow;
      columns: Pick<ListColumn, 'id' | 'kind'>[];
    })
  | (UndoBase & {
      kind: 'column'; blockId: string; column: ListColumn;
      cells: Record<string, string>;
    });
export interface ProjectDeletion { content: ProjectContent; undo: ProjectUndo }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_KEYS = ['id', 'name', 'labels', 'blocks'];
const DELIVERY_KINDS: readonly DeliveryKind[] = ['shot', 'stage', 'date', 'delivered'];
const COLUMN_NAMES: Record<DeliveryKind, string> = {
  shot: '镜头', stage: '当前阶段', date: '当前交期', delivered: '已交完',
};
const MAX_BYTES = 16 * 1024 * 1024;

function fail(message = '项目数据结构不完整或类型不正确，未替换现有内容。'): never {
  throw new Error(message);
}
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const result = value as Record<string, unknown>;
  const own = Reflect.ownKeys(result);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key)!;
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) return fail();
  }
  if (keys && (own.length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) return fail();
  return result;
}
function array(value: unknown, maximum = Infinity): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail('项目集合类型错误或数量超出限制。');
  return Array.from(value); // Sparse entries become undefined and fail their item parser.
}
function text(value: unknown, maximum = Infinity, required = false): string {
  if (typeof value !== 'string' || required && !value.trim()) return fail('文本类型错误或必填内容为空。');
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (++length > maximum || point >= 0xd800 && point <= 0xdfff) {
      return fail('文本超过字符上限或包含无效的 Unicode 字符。');
    }
  }
  return value;
}
function entityId(value: unknown, used?: Set<string>): string {
  if (typeof value !== 'string' || !UUID.test(value)) return fail('实体编号必须是合法 UUID。');
  const key = value.toLowerCase();
  if (used?.has(key)) return fail('同一范围内存在重复的实体编号。');
  used?.add(key);
  return value;
}
function columnKind(value: unknown): ColumnKind {
  if (value !== 'text' && value !== 'shot' && value !== 'stage'
    && value !== 'date' && value !== 'delivered') return fail('列类型不合法。');
  return value;
}
function withinSize<T extends ProjectContent>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) {
    return fail('单个项目序列化后不能超过 16 MiB。');
  }
  return value;
}

export function parseProjectContent(value: unknown): ProjectContent {
  const p = object(value, CONTENT_KEYS);
  const used = new Set<string>();
  const id = entityId(p.id, used);
  const name = text(p.name, 200, true);
  const names = new Set<string>();
  const labels = array(p.labels, 100).map(raw => {
    const label = object(raw, ['id', 'name']);
    const result = { id: entityId(label.id, used), name: text(label.name, 80, true) };
    if (names.has(result.name.trim())) return fail('同一项目不能有重名标签。');
    names.add(result.name.trim());
    return result;
  });
  const labelIds = new Set(labels.map(label => label.id));
  const blocks = array(p.blocks, 200).map((raw): ProjectBlock => {
    const b = object(raw);
    const base = { id: entityId(b.id, used), title: text(b.title, 200, true) };
    if (b.kind === 'text') {
      object(b, ['id', 'kind', 'title', 'body']);
      return { ...base, kind: 'text', body: text(b.body, 100000) };
    }
    if (b.kind === 'checklist') {
      object(b, ['id', 'kind', 'title', 'items']);
      const items = array(b.items, 10000);
      return {
        ...base, kind: 'checklist',
        items: items.map(rawItem => {
          const item = object(rawItem, ['id', 'text', 'checked']);
          if (typeof item.checked !== 'boolean') return fail();
          return { id: entityId(item.id, used), text: text(item.text, 10000), checked: item.checked };
        }),
      };
    }
    if (b.kind !== 'list') return fail('文档块类型不合法。');
    object(b, ['id', 'kind', 'title', 'included', 'columns', 'rows']);
    if (typeof b.included !== 'boolean') return fail();
    const semantic = new Set<ColumnKind>();
    const columns = array(b.columns, 64).map((rawColumn): ListColumn => {
      const c = object(rawColumn);
      object(c, Object.hasOwn(c, 'width') ? ['id', 'name', 'kind', 'width'] : ['id', 'name', 'kind']);
      if (Object.hasOwn(c, 'width') && (typeof c.width !== 'number' || !Number.isInteger(c.width)
        || c.width < LIST_MIN_WIDTH || c.width > LIST_MAX_WIDTH)) return fail('列宽必须是 112–640 的整数。');
      const kind = columnKind(c.kind);
      if (kind !== 'text' && semantic.has(kind)) return fail('每种交付语义列最多只能有一列。');
      semantic.add(kind);
      return { id: entityId(c.id, used), name: text(c.name, 200, true), kind,
        ...(Object.hasOwn(c, 'width') ? { width: c.width as number } : {}) };
    });
    const columnMap = new Map(columns.map(column => [column.id, column]));
    const rows = array(b.rows, 10000).map((rawRow): ListRow => {
      const row = object(rawRow, ['id', 'cells']);
      const rowId = entityId(row.id, used);
      const cells: Record<string, string> = {};
      for (const [key, rawCell] of Object.entries(object(row.cells))) {
        const column = columnMap.get(key);
        if (!column) return fail('单元格引用了当前 list 中不存在的列。');
        const cell = text(rawCell, column.kind === 'shot' ? 200 : 10000);
        if (column.kind === 'stage' && cell !== '' && !labelIds.has(cell)) {
          return fail('阶段必须引用本项目现有标签。');
        }
        if (column.kind === 'date' && cell !== '' && !validDate(cell)) {
          return fail('交期必须为空或有效的完整年月日。');
        }
        if (column.kind === 'delivered' && cell !== '' && cell !== 'true' && cell !== 'false') {
          return fail('交完状态只能为空、true 或 false 字符串。');
        }
        cells[key] = cell;
      }
      return { id: rowId, cells };
    });
    return { ...base, kind: 'list', included: b.included, columns, rows };
  });
  return withinSize({ id, name, labels, blocks });
}

export function parseProject(value: unknown): ProjectDocument {
  const p = object(value, [...CONTENT_KEYS, 'revision', 'createdAt']);
  if (typeof p.revision !== 'number' || !Number.isSafeInteger(p.revision) || p.revision < 1
    || typeof p.createdAt !== 'string' || !Number.isFinite(Date.parse(p.createdAt))) return fail();
  const content = parseProjectContent({ id: p.id, name: p.name, labels: p.labels, blocks: p.blocks });
  return { ...content, revision: p.revision, createdAt: p.createdAt };
}
export function parseProjects(value: unknown): ProjectDocument[] {
  const used = new Set<string>();
  return array(value).map(raw => {
    const project = parseProject(raw);
    entityId(project.id, used);
    return project;
  });
}

export function deriveDeliveries(projects: readonly ProjectContent[]): Delivery[] {
  const result: Delivery[] = [];
  for (const project of projects) {
    const labels = new Map(project.labels.map(label => [label.id, label.name]));
    for (const block of project.blocks) {
      if (block.kind !== 'list' || !block.included) continue;
      const columns = new Map(block.columns.map(column => [column.kind, column.id]));
      for (const row of block.rows) {
        const cell = (kind: DeliveryKind) => row.cells[columns.get(kind) ?? ''] ?? '';
        if (cell('delivered') === 'true') continue;
        const shot = cell('shot'), stageId = cell('stage'), dueDate = cell('date');
        const stageName = labels.get(stageId) ?? '';
        const missing: DeliveryField[] = [];
        if (!shot.trim()) missing.push('shot');
        if (!stageId || !stageName) missing.push('stageId');
        if (!dueDate) missing.push('dueDate');
        result.push({
          projectId: project.id, projectName: project.name,
          blockId: block.id, blockTitle: block.title, rowId: row.id,
          shot, stageId, stageName, dueDate, missing,
        });
      }
    }
  }
  // Stable sort retains project/block/row traversal order for equal dates.
  return result.sort((a, b) => a.dueDate === b.dueDate ? 0
    : !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate < b.dueDate ? -1 : 1);
}

export function ensureDeliveryColumns(block: ListBlock, ids: DeliveryColumnIds): ListBlock {
  const provided = object(ids, DELIVERY_KINDS);
  const proposed = new Set<string>();
  for (const kind of DELIVERY_KINDS) entityId(provided[kind], proposed);
  const occupied = new Set<string>();
  for (const entity of [block, ...block.columns, ...block.rows]) entityId(entity.id, occupied);
  const additions = DELIVERY_KINDS.filter(kind => !block.columns.some(column => column.kind === kind))
    .map(kind => ({ id: entityId(provided[kind], occupied), kind, name: COLUMN_NAMES[kind] }));
  if (block.columns.length + additions.length > 64) return fail('补齐交付列后将超过每个 list 的 64 列上限。');
  return {
    ...block, included: true,
    columns: [...block.columns.map(column => ({ ...column })), ...additions],
    rows: block.rows.map(row => ({ id: row.id, cells: { ...row.cells } })),
  };
}

// Clone only editable content; passing a ProjectDocument never rolls back its metadata.
function copyContent(content: ProjectContent): ProjectContent {
  const { id, name, labels, blocks } = content;
  return parseProjectContent({ id, name, labels, blocks });
}
function list(content: ProjectContent, blockId: string): ListBlock {
  const block = content.blocks.find(item => item.id === blockId);
  if (!block || block.kind !== 'list') return fail('目标 list 已不存在，无法继续操作。');
  return block;
}
function take<T extends { id: string }>(items: T[], id: string): { item: T; position: UndoPosition } {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return fail('要删除的对象已不存在。');
  const position = { beforeId: items[index - 1]?.id ?? null, afterId: items[index + 1]?.id ?? null };
  return { item: items.splice(index, 1)[0], position };
}
function insert<T extends { id: string }>(items: T[], item: T, position: UndoPosition): void {
  const before = items.findIndex(value => value.id === position.beforeId);
  const after = items.findIndex(value => value.id === position.afterId);
  if (before >= 0 && after >= 0 && before >= after) return fail('原位置的相邻对象顺序已冲突，无法撤销。');
  // Prefer the next neighbour, then the previous; append if neither survives.
  items.splice(after >= 0 ? after : before >= 0 ? before + 1 : items.length, 0, item);
}
function allIds(content: ProjectContent): Set<string> {
  const ids = [content.id, ...content.labels.map(label => label.id)];
  for (const block of content.blocks) {
    ids.push(block.id);
    if (block.kind === 'list') ids.push(...block.columns.map(c => c.id), ...block.rows.map(r => r.id));
    if (block.kind === 'checklist') ids.push(...block.items.map(item => item.id));
  }
  return new Set(ids.map(id => id.toLowerCase()));
}

export function deleteBlock(content: ProjectContent, blockId: string): ProjectDeletion {
  const next = copyContent(content);
  const { item, position } = take(next.blocks, blockId);
  return { content: next, undo: { kind: 'block', projectId: next.id, position, block: item } };
}
export function deleteChecklistItem(content: ProjectContent, blockId: string, itemId: string): ProjectDeletion {
  const next = copyContent(content);
  const block = next.blocks.find(item => item.id === blockId);
  if (!block || block.kind !== 'checklist') return fail('目标项目清单已不存在，无法继续操作。');
  const { item, position } = take(block.items, itemId);
  return { content: next, undo: { kind: 'checklist-item', projectId: next.id, blockId, position, item } };
}
export function deleteRow(content: ProjectContent, blockId: string, rowId: string): ProjectDeletion {
  const next = copyContent(content), block = list(next, blockId);
  const { item, position } = take(block.rows, rowId);
  const columns = block.columns.filter(column => Object.hasOwn(item.cells, column.id))
    .map(({ id, kind }) => ({ id, kind }));
  return {
    content: next,
    undo: { kind: 'row', projectId: next.id, blockId, position, row: item, columns },
  };
}
export function deleteColumn(content: ProjectContent, blockId: string, columnId: string): ProjectDeletion {
  const next = copyContent(content), block = list(next, blockId);
  const { item, position } = take(block.columns, columnId);
  const cells: Record<string, string> = {};
  for (const row of block.rows) {
    if (Object.hasOwn(row.cells, columnId)) cells[row.id] = row.cells[columnId];
    delete row.cells[columnId];
  }
  return {
    content: next,
    undo: { kind: 'column', projectId: next.id, blockId, position, column: item, cells },
  };
}
export function restoreUndo(content: ProjectContent, undo: ProjectUndo): ProjectContent {
  const next = copyContent(content);
  if (next.id !== undo.projectId) return fail('撤销记录不属于当前项目。');
  const entity = undo.kind === 'block' ? undo.block : undo.kind === 'checklist-item' ? undo.item : undo.kind === 'row' ? undo.row : undo.column;
  if (allIds(next).has(entity.id.toLowerCase())) return fail('被删除对象的编号已被占用，无法撤销。');
  if (undo.kind === 'block') {
    insert(next.blocks, undo.block, undo.position);
  } else if (undo.kind === 'checklist-item') {
    const block = next.blocks.find(item => item.id === undo.blockId);
    if (!block || block.kind !== 'checklist') return fail('目标项目清单已不存在，无法恢复事项。');
    insert(block.items, undo.item, undo.position);
  } else {
    const block = list(next, undo.blockId);
    if (undo.kind === 'row') {
      if (undo.columns.some(old => !block.columns.some(c => c.id === old.id && c.kind === old.kind))) {
        return fail('被删除行引用的列已移除或改变类型，无法撤销。');
      }
      insert(block.rows, undo.row, undo.position);
    } else {
      const replacement = undo.column.kind === 'text' ? undefined
        : block.columns.find(column => column.kind === undo.column.kind);
      if (replacement) {
        if (block.rows.some(row => (row.cells[replacement.id] ?? '') !== '')) {
          return fail('补回的语义列已有新值，未覆盖；清空冲突值后可再次撤销。');
        }
        block.columns = block.columns.filter(column => column.id !== replacement.id);
        for (const row of block.rows) delete row.cells[replacement.id];
      }
      insert(block.columns, undo.column, undo.position);
      for (const row of block.rows) {
        if (Object.hasOwn(undo.cells, row.id)) row.cells[undo.column.id] = undo.cells[row.id];
      }
    }
  }
  // Recheck nested ID collisions, references, limits and restored cell values.
  // Parsing also detaches the result from the retained undo snapshot.
  return parseProjectContent(next);
}
