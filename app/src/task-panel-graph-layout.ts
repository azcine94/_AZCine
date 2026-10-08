import type { GraphNode, GraphView, Relation } from './task-panel-contract.ts';

export const graphNodeWidth = 184;
const columnStep = 252, rowStep = 76;
export interface GraphPosition { x: number; y: number; column: number; width?: number; height?: number }
const kindNames: Record<string, string> = { project: '项目', goal: '目标', phase: '阶段', task: '任务', requirement: '需求', file: '文件', symbol: '符号', component: '组件', module: '模块', interface: '接口', service: '服务', storage: '存储', external: '外部', execution: '执行', evidence: '证据', artifact: '产物', decision: '决定', memory: '记忆', check: '验证', acceptance: '验收' };
export const graphKindName = (kind: string) => kindNames[kind] ?? '关联对象';

function taskFlowNeighbors(relations: Relation[], focusedTask: string) {
  const dependencies = relations.filter(r => r.kind === 'depends_on');
  const walk = (upstream: boolean) => {
    const seen = new Set([focusedTask]), queue = [focusedTask];
    for (let i = 0; i < queue.length; i++) for (const edge of dependencies) {
      const from = upstream ? edge.fromId : edge.toId, to = upstream ? edge.toId : edge.fromId;
      if (from === queue[i] && !seen.has(to)) { seen.add(to); queue.push(to); }
    }
    seen.delete(focusedTask); return seen;
  };
  return { prerequisites: walk(true), downstream: walk(false) };
}

/** Keep execution records in the task sidebar, including while switching graph layers. */
export function taskFlowView(graph: GraphView, focusedTask: string | null): GraphView {
  const flowNodes = graph.nodes.filter(node => ['project', 'goal', 'phase', 'task'].includes(node.kind));
  const flowIds = new Set(flowNodes.map(node => node.id));
  const flowRelations = graph.relations.filter(edge => ['depends_on', 'contains'].includes(edge.kind) && flowIds.has(edge.fromId) && flowIds.has(edge.toId));
  let visible = flowIds;
  if (focusedTask && flowIds.has(focusedTask)) {
    const { prerequisites, downstream } = taskFlowNeighbors(flowRelations, focusedTask);
    visible = new Set([focusedTask, ...prerequisites, ...downstream]);
    const queue = [...visible];
    for (let i = 0; i < queue.length; i++) for (const edge of flowRelations.filter(r => r.kind === 'contains')) {
      if (edge.toId === queue[i] && !visible.has(edge.fromId)) { visible.add(edge.fromId); queue.push(edge.fromId); }
    }
  }
  return { ...graph, nodes: flowNodes.filter(node => visible.has(node.id)), relations: flowRelations.filter(edge => visible.has(edge.fromId) && visible.has(edge.toId)) };
}

export function layoutTaskGraph(graph: Pick<GraphView, 'nodes' | 'relations'>, focusedTask: string | null = null, taskFlow = false) {
  const nodeWidth = taskFlow ? 240 : graphNodeWidth, nodeHeight = taskFlow ? 92 : 60;
  const stepX = taskFlow ? 308 : columnStep, stepY = taskFlow ? 128 : rowStep;
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
    const { prerequisites } = taskFlowNeighbors(graph.relations, focusedTask);
    const labels = ['前置与归属', '当前任务', '下游任务'];
    groups = labels.map(label => ({ label, nodes: [] }));
    for (const node of graph.nodes) {
      const column = node.id === focusedTask ? 1 : prerequisites.has(node.id) || ['project', 'goal', 'phase'].includes(node.kind) ? 0 : 2;
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
  for (const [column, group] of groups.entries()) group.nodes.forEach((node, row) => positions.set(node.id, { x: 24 + column * stepX, y: 48 + row * stepY, column, width: nodeWidth, height: nodeHeight }));
  return { positions, columns: groups.map((g, i) => ({ label: g.label, count: g.nodes.length, x: 24 + i * stepX })), width: 24 + groups.length * stepX, height: Math.max(300, 48 + Math.max(0, ...groups.map(g => g.nodes.length)) * stepY + 16) };
}

export function taskGraphPath(edge: Pick<Relation, 'fromId' | 'toId'>, positions: Map<string, GraphPosition>) {
  const a = positions.get(edge.fromId), b = positions.get(edge.toId);
  if (!a || !b) return '';
  const y1 = a.y + (a.height ?? 60) / 2, y2 = b.y + (b.height ?? 60) / 2;
  if (a.column === b.column) {
    const x = a.x + (a.width ?? graphNodeWidth);
    return a === b ? `M${x},${y1 - 8} C${x + 40},${y1 - 36} ${x + 40},${y1 + 36} ${x},${y1 + 8}` : `M${x},${y1} C${x + 36},${y1} ${x + 36},${y2} ${x},${y2}`;
  }
  const direction = b.x > a.x ? 1 : -1, x1 = a.x + (direction > 0 ? a.width ?? graphNodeWidth : 0), x2 = b.x + (direction > 0 ? 0 : b.width ?? graphNodeWidth);
  if (Math.abs(a.column - b.column) === 1) {
    const middle = (x1 + x2) / 2;
    return `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
  }
  // Long edges pass through the clear strip below column headings, away from intermediate cards.
  const out = x1 + direction * 28, enter = x2 - direction * 28;
  return `M${x1},${y1} C${out},${y1} ${out},40 ${out + direction * 12},40 L${enter - direction * 12},40 C${enter},40 ${enter},${y2} ${x2},${y2}`;
}

/** The project overview uses membership for placement; dependencies do not turn siblings into a sequence. */
export function layoutTaskOverview(graph: Pick<GraphView, 'nodes' | 'relations'>, availableWidth: number) {
  const hierarchy = layoutTaskGraph({ nodes: graph.nodes, relations: graph.relations.filter(edge => edge.kind === 'contains') });
  const width = Math.max(availableWidth, 288), nodeWidth = 240, nodeHeight = 92, gap = 40;
  const perRow = Math.max(1, Math.floor((width - 48 + gap) / (nodeWidth + gap)));
  const positions = new Map<string, GraphPosition>();
  let top = 24;
  for (let level = 0; level < hierarchy.columns.length; level++) {
    const members = graph.nodes.filter(node => hierarchy.positions.get(node.id)?.column === level)
      .sort((a, b) => hierarchy.positions.get(a.id)!.y - hierarchy.positions.get(b.id)!.y);
    if (!members.length) continue;
    const rows = Math.ceil(members.length / perRow);
    members.forEach((node, index) => {
      const row = Math.floor(index / perRow), rowCount = Math.min(perRow, members.length - row * perRow);
      const left = (width - rowCount * nodeWidth - (rowCount - 1) * gap) / 2;
      positions.set(node.id, { x: left + index % perRow * (nodeWidth + gap), y: top + row * (nodeHeight + 28), column: level, width: nodeWidth, height: nodeHeight });
    });
    top += rows * nodeHeight + (rows - 1) * 28 + 64;
  }
  return { positions, columns: [] as { label: string; count: number; x: number }[], width, height: Math.max(340, top - 40) };
}

export function taskOverviewPath(edge: Pick<Relation, 'fromId' | 'toId' | 'kind'>, positions: Map<string, GraphPosition>) {
  const dependency = edge.kind === 'depends_on';
  const from = positions.get(dependency ? edge.toId : edge.fromId), to = positions.get(dependency ? edge.fromId : edge.toId);
  if (!from || !to) return '';
  const ax = from.x + (from.width ?? graphNodeWidth) / 2, ay = from.y + (from.height ?? 60);
  const bx = to.x + (to.width ?? graphNodeWidth) / 2, by = to.y;
  if (from === to) {
    const right = from.x + (from.width ?? graphNodeWidth), middle = from.y + (from.height ?? 60) / 2;
    return `M${right},${middle - 10} C${right + 24},${middle - 32} ${right + 24},${middle + 32} ${right},${middle + 10}`;
  }
  if (dependency && from.y === to.y) {
    const bottom = Math.max(ay, to.y + (to.height ?? 60)), route = bottom + 24;
    return `M${ax},${ay} C${ax},${route} ${ax},${route} ${ax + (bx - ax) / 3},${route} L${bx - (bx - ax) / 3},${route} C${bx},${route} ${bx},${route} ${bx},${bottom}`;
  }
  if (dependency || by - ay > 120) {
    const route = Math.max(...[...positions.values()].map(position => position.x + (position.width ?? graphNodeWidth))) + 12;
    return `M${ax},${ay} L${ax},${ay + 24} L${route},${ay + 24} L${route},${by - 24} L${bx},${by - 24} L${bx},${by}`;
  }
  const middle = (ay + by) / 2;
  return `M${ax},${ay} C${ax},${middle} ${bx},${middle} ${bx},${by}`;
}
