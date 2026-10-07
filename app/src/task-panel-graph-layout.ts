import type { GraphNode, GraphView, Relation } from './task-panel-contract.ts';

export const graphNodeWidth = 184;
const columnStep = 252, rowStep = 76;
export interface GraphPosition { x: number; y: number; column: number }
const kindNames: Record<string, string> = { project: '项目', goal: '目标', phase: '阶段', task: '任务', requirement: '需求', file: '文件', symbol: '符号', component: '组件', module: '模块', interface: '接口', service: '服务', storage: '存储', external: '外部', execution: '执行', evidence: '证据', artifact: '产物', decision: '决定', memory: '记忆', check: '验证', acceptance: '验收' };
export const graphKindName = (kind: string) => kindNames[kind] ?? '关联对象';

export function layoutTaskGraph(graph: Pick<GraphView, 'nodes' | 'relations'>, focusedTask: string | null = null) {
  const ids = new Set(graph.nodes.map(n => n.id));
  const adjacent = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
  for (const edge of graph.relations) {
    if (!ids.has(edge.fromId) || !ids.has(edge.toId) || edge.kind === 'may_affect') continue;
    // A dependency is stored from the dependent to its prerequisite; display prerequisites first.
    const [from, to] = edge.kind === 'depends_on' ? [edge.toId, edge.fromId] : [edge.fromId, edge.toId];
    adjacent.get(from)!.push(to);
  }
  // Keep cycles in one column so recursion cannot keep creating more layers.
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], pending = new Set<string>(), component = new Map<string, number>();
  let next = 0, count = 0;
  function visit(id: string) {
    index.set(id, next); low.set(id, next++); stack.push(id); pending.add(id);
    for (const target of adjacent.get(id)!) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
      else if (pending.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      let member: string; do { member = stack.pop()!; pending.delete(member); component.set(member, count); } while (member !== id);
      count++;
    }
  }
  for (const node of graph.nodes) if (!index.has(node.id)) visit(node.id);
  const outgoing = Array.from({ length: count }, () => new Set<number>()), incoming = Array(count).fill(0), rank = Array(count).fill(0);
  for (const [from, targets] of adjacent) for (const to of targets) {
    const a = component.get(from)!, b = component.get(to)!;
    if (a !== b && !outgoing[a].has(b)) { outgoing[a].add(b); incoming[b]++; }
  }
  const queue = incoming.flatMap((n, i) => n === 0 ? [i] : []);
  for (let i = 0; i < queue.length; i++) for (const target of outgoing[queue[i]]) {
    rank[target] = Math.max(rank[target], rank[queue[i]] + 1);
    if (--incoming[target] === 0) queue.push(target);
  }
  let groups: { label: string; nodes: GraphNode[] }[];
  if (focusedTask && ids.has(focusedTask)) {
    const prerequisites = new Set<string>(), downstream = new Set<string>();
    for (const edge of graph.relations.filter(e => e.kind === 'depends_on')) {
      if (edge.fromId === focusedTask) prerequisites.add(edge.toId);
      if (edge.toId === focusedTask) downstream.add(edge.fromId);
    }
    const labels = ['前置与归属', '当前任务', '下游', '关联记录'];
    groups = labels.map(label => ({ label, nodes: [] }));
    for (const node of graph.nodes) {
      const column = node.id === focusedTask ? 1 : prerequisites.has(node.id) || ['project', 'goal', 'phase'].includes(node.kind) ? 0 : downstream.has(node.id) ? 2 : 3;
      groups[column].nodes.push(node);
    }
  } else {
    groups = Array.from({ length: Math.max(0, ...rank) + 1 }, () => ({ label: '', nodes: [] as GraphNode[] }));
    for (const node of graph.nodes) groups[rank[component.get(node.id)!]].nodes.push(node);
    for (const group of groups) group.label = [...new Set(group.nodes.map(n => graphKindName(n.kind)))].join(' / ') || '关联对象';
  }
  const order = new Map<string, number>();
  groups.forEach((group, column) => {
    const score = (node: GraphNode) => {
      const parents = [...adjacent].filter(([from, targets]) => order.has(from) && targets.includes(node.id)).map(([from]) => order.get(from)!);
      return parents.length ? parents.reduce((sum, row) => sum + row, 0) / parents.length : Number.MAX_SAFE_INTEGER;
    };
    if (column > 0) group.nodes.sort((a, b) => score(a) - score(b));
    group.nodes.forEach((node, row) => order.set(node.id, row));
  });
  const positions = new Map<string, GraphPosition>();
  for (const [column, group] of groups.entries()) group.nodes.forEach((node, row) => positions.set(node.id, { x: 24 + column * columnStep, y: 48 + row * rowStep, column }));
  return { positions, columns: groups.map((g, i) => ({ label: g.label, count: g.nodes.length, x: 24 + i * columnStep })), width: 24 + groups.length * columnStep, height: Math.max(300, 48 + Math.max(0, ...groups.map(g => g.nodes.length)) * rowStep + 16) };
}

export function taskGraphPath(edge: Pick<Relation, 'fromId' | 'toId'>, positions: Map<string, GraphPosition>) {
  const a = positions.get(edge.fromId), b = positions.get(edge.toId);
  if (!a || !b) return '';
  const y1 = a.y + 30, y2 = b.y + 30;
  if (a.column === b.column) {
    const x = a.x + graphNodeWidth;
    return a === b ? `M${x},${y1 - 8} C${x + 40},${y1 - 36} ${x + 40},${y1 + 36} ${x},${y1 + 8}` : `M${x},${y1} C${x + 36},${y1} ${x + 36},${y2} ${x},${y2}`;
  }
  const direction = b.x > a.x ? 1 : -1, x1 = a.x + (direction > 0 ? graphNodeWidth : 0), x2 = b.x + (direction > 0 ? 0 : graphNodeWidth);
  if (Math.abs(a.column - b.column) === 1) {
    const middle = (x1 + x2) / 2;
    return `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
  }
  // Long edges pass through the clear strip below column headings, away from intermediate cards.
  const out = x1 + direction * 28, enter = x2 - direction * 28;
  return `M${x1},${y1} C${out},${y1} ${out},40 ${out + direction * 12},40 L${enter - direction * 12},40 C${enter},40 ${enter},${y2} ${x2},${y2}`;
}
