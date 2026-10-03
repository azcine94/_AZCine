import { deleteBlock, deleteChecklistItem, deleteColumn, deleteRow, ensureDeliveryColumns, restoreUndo } from './projects-contract.ts';
import type { ListBlock, ProjectContent, ProjectUndo } from './projects-contract.ts';

export function removeEntity(content: ProjectContent, type: 'block' | 'column' | 'row' | 'checklist-item', blockId: string, entityId?: string) {
  if (type === 'block') return deleteBlock(content, blockId);
  if (!entityId) throw new Error('缺少要删除的对象编号，未修改文档。');
  if (type === 'checklist-item') return deleteChecklistItem(content, blockId, entityId);
  return type === 'column' ? deleteColumn(content, blockId, entityId) : deleteRow(content, blockId, entityId);
}
export function restoreEntity(content: ProjectContent, undo: ProjectUndo | undefined) {
  if (!undo) throw new Error('没有可恢复的删除记录。');
  return restoreUndo(content, undo);
}
export function includeList(block: ListBlock): ListBlock {
  return ensureDeliveryColumns(block, { shot: crypto.randomUUID(), stage: crypto.randomUUID(), date: crypto.randomUUID(), delivered: crypto.randomUUID() });
}
