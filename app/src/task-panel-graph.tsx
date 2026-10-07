import { useEffect, useRef, useState } from 'react';
import { GitBranch, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { Label } from './components/ui/label.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { LoadingStatus } from './components/ui/loading-status.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover.tsx';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { laneLabels, levelLabels, taskNumber } from './task-panel-contract.ts';
import { graphKindName, layoutTaskGraph, taskGraphPath } from './task-panel-graph-layout.ts';
import { TaskGraphActions } from './task-panel-workflow.tsx';
import type { TaskPanelController } from './use-task-panel.ts';

export function RelationshipGraph({ model }: { model: TaskPanelController }) {
  const [zoom, setZoom] = useState(1), scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const input = { workspaceTaskId: model.selectedId, layer: model.graphMode === 'task' ? 'execution' as const : 'code' as const, projectId: model.projectFilter || null, taskId: model.graphMode === 'task' ? model.selectedId || model.projectFilter || null : model.graphCenter, repositoryId: model.graphMode === 'task' ? null : model.repositoryFilter || null, depth: model.graphDepth, offset: 0, limit: 80, kinds: model.graphFilter === 'prerequisites' ? ['depends_on'] : model.graphFilter === 'impact' ? ['may_affect'] : [], levels: model.graphFilter === 'proof' ? ['observed', 'user_confirmed'] : model.graphFilter === 'stale' ? ['stale'] : [] };
  useEffect(() => { if (model.tab === 'graph' && (model.graphMode === 'architecture' || model.selectedId || model.projectFilter)) void model.loadGraph(input); }, [model.tab, model.graphMode, model.selectedId, model.projectFilter, model.repositoryFilter, model.graphCenter, model.graphDepth, model.graphFilter, model.snapshot]);
  useEffect(() => { setZoom(1); scroll.current?.scrollTo({ left: 0, top: 0 }); }, [model.graphMode, model.projectFilter, model.graphCenter]);
  const graph = model.graph;
  const focusedTask = model.graphMode === 'task' && model.snapshot?.tasks.some(t => t.id === model.selectedId) ? model.selectedId : null;
  const selected = model.graphMode === 'architecture' ? model.selectedNode : model.selectedId;
  const layout = layoutTaskGraph(graph ?? { nodes: [], relations: [] }, focusedTask);
  const staleCount = graph?.nodes.filter(n => n.stale).length ?? 0;
  return <div className="tp-graph-panel">
    <header className="tp-graph-bar">
      <Tabs value={model.graphMode} onValueChange={value => { model.setGraphMode(value as 'architecture' | 'task'); model.selectNode(null); model.setGraphCenter(null); }}>
        <TabsList aria-label="图视图" className="h-8"><TabsTrigger value="task">项目执行图</TabsTrigger><TabsTrigger value="architecture">代码结构图</TabsTrigger></TabsList>
      </Tabs>
      <span className="tp-meta tp-graph-summary">{focusedTask ? `聚焦 ${taskNumber(model.snapshot!.tasks.find(t => t.id === focusedTask)!)}` : `${graph?.nodes.length ?? 0}/${graph?.totalNodes ?? 0} 个对象`} · 图修订 {graph?.graphRevision ?? '—'}{staleCount > 0 && ` · 待复核 ${staleCount}`}</span>
      <TaskGraphActions model={model} />
    </header>
    {model.graphError && <Feedback tone="error" role="alert">{model.graphError}</Feedback>}
    <LoadingStatus active={model.graphLoading} delayMs={graph?.nodes.length ? 250 : 0}>正在读取关系…</LoadingStatus>
    {!graph?.nodes.length ? <EmptyState><GitBranch /><h2>{model.graphMode === 'task' && !model.selectedId && !model.projectFilter ? '先选择一个项目或任务' : '尚无匹配的关系'}</h2><p>登记任务，或核对导入代码关系；也可以调整关系筛选。未建图时影响范围未知。</p></EmptyState> :
      <div className="tp-graph-scroll" ref={scroll} tabIndex={0} aria-label="可平移的关系图"
        onPointerDown={e => { if ((e.target as Element).closest('button')) return; drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) { e.currentTarget.scrollLeft = drag.current.left + drag.current.x - e.clientX; e.currentTarget.scrollTop = drag.current.top + drag.current.y - e.clientY; } }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="tp-graph-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <svg width={layout.width} height={layout.height} aria-label="关系连线">
              {graph.relations.map(edge => {
                const d = taskGraphPath(edge, layout.positions); if (!d) return null;
                const highlighted = !!selected && (edge.fromId === selected || edge.toId === selected);
                return <path key={edge.id} d={d} className="tp-graph-edge" data-kind={edge.kind} data-level={edge.evidenceLevel} data-highlighted={highlighted} data-dimmed={!!selected && !highlighted}>
                  <title>{graph.nodes.find(n => n.id === edge.fromId)?.label} → {graph.nodes.find(n => n.id === edge.toId)?.label} · {edge.kind} · {levelLabels[edge.evidenceLevel]}</title>
                </path>;
              })}
            </svg>
            {layout.columns.map((column, i) => <div className="tp-graph-column" key={i} style={{ left: column.x }}>{column.label} · {column.count}</div>)}
            {graph.nodes.map(node => {
              const position = layout.positions.get(node.id)!, task = model.snapshot?.tasks.find(t => t.id === node.id);
              const subtitle = task ? `${taskNumber(task)} · ${laneLabels[task.lane]}` : `${node.path ? node.path.replaceAll('\\', '/').split('/').pop() : graphKindName(node.kind)} · ${levelLabels[node.evidenceLevel]}`;
              return <Card key={node.id} className="tp-graph-position p-0 gap-0" data-selected={selected === node.id} style={{ left: position.x, top: position.y }}>
                <Button variant="app-control" className="tp-graph-node" aria-pressed={selected === node.id} title={`${node.label}\n${subtitle}${node.stale ? '\n出处已变 · 待复核' : ''}`} onClick={() => { model.selectNode(node.id); if (task) model.select(task.id); }}>
                  <strong>{node.label}</strong><span>{subtitle}</span>{node.stale && <i className="tp-dot tp-tone-warning tp-graph-stale" aria-label="出处已变，待复核" />}
                </Button>
              </Card>;
            })}
          </div>
        </div>
      </div>}
    <footer className="tp-graph-footer">
      <div className="tp-graph-legend"><span><i className="tp-graph-key-dependency" />明确前置</span><span><i />已登记关联</span><span><i className="tp-graph-key-candidate" />静态影响候选</span></div>
      <div className="tp-graph-tools">
        <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="关系图筛选"><SlidersHorizontal />筛选{model.graphFilter !== 'all' && ' · 已启用'}</Button></PopoverTrigger><PopoverContent className="grid gap-4" align="end">
          <Label className="grid gap-2">关系分类<NativeSelect variant="app" aria-label="关系分类" value={model.graphFilter} onChange={e => model.setGraphFilter(e.target.value)}><option value="all">全部关系</option><option value="prerequisites">明确前置</option><option value="proof">程序观察与本人核对</option><option value="impact">静态影响候选</option><option value="stale">出处已变 · 待复核</option></NativeSelect></Label>
          <Label className="grid gap-2">关系展开深度<NativeSelect variant="app" aria-label="关系展开深度" value={model.graphDepth} onChange={e => model.setGraphDepth(Number(e.target.value))}>{[1, 2, 3, 4].map(d => <option key={d} value={d}>展开 {d} 层</option>)}</NativeSelect></Label>
        </PopoverContent></Popover>
        <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost">范围与未知 · {graph?.unknowns.length ?? 0}</Button></PopoverTrigger><PopoverContent className="w-96 max-w-[calc(100vw-32px)] max-h-80 overflow-auto text-sm" align="end"><h3 className="font-semibold">范围与未知项</h3><p className="tp-meta mt-2">当前展示 {graph?.nodes.length ?? 0}/{graph?.totalNodes ?? 0} 个对象。连线表示已登记关系，实际方向与来源可点节点核对。</p>{graph?.unknowns.map((s, i) => <p className="mt-3" key={i}>{s}</p>)}<details className="mt-3"><summary>查看覆盖记录</summary><pre className="tp-source">{JSON.stringify(graph?.coverage ?? [], null, 2)}</pre></details></PopoverContent></Popover>
        <Button size="icon-sm" variant="ghost" aria-label="缩小关系图" onClick={() => setZoom(z => Math.max(.5, z - .1))}><Minus /></Button><span className="tp-mono tp-meta">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="放大关系图" onClick={() => setZoom(z => Math.min(1.8, z + .1))}><Plus /></Button><Button size="sm" variant="ghost" onClick={() => { setZoom(1); scroll.current?.scrollTo({ left: 0, top: 0 }); }}>聚焦</Button>
        {graph?.hasMore && <Button size="sm" variant="outline" disabled={model.graphLoading} onClick={() => void model.loadGraph({ ...input, offset: graph.offset + 80 }, true)}>继续加载</Button>}
      </div>
    </footer>
  </div>;
}
