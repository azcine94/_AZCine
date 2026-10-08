import { useEffect, useId, useRef, useState } from 'react';
import { GitBranch, LocateFixed, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { Label } from './components/ui/label.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover.tsx';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { laneLabels, levelLabels, taskNumber } from './task-panel-contract.ts';
import { graphKindName, layoutTaskGraph, layoutTaskOverview, taskFlowView, taskGraphPath, taskOverviewPath } from './task-panel-graph-layout.ts';
import { compactGitStatus, gitStatus, taskGit } from './task-panel-observation.tsx';
import { TaskGraphActions } from './task-panel-workflow.tsx';
import type { TaskPanelController } from './use-task-panel.ts';

export function RelationshipGraph({ model }: { model: TaskPanelController }) {
  const [zoom, setZoom] = useState(1), scroll = useRef<HTMLDivElement>(null);
  const [taskFocus, setTaskFocus] = useState(false), [canvasWidth, setCanvasWidth] = useState(760);
  const markerId = `tp-dependency-${useId().replaceAll(':', '')}`;
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const taskMode = model.graphMode === 'task';
  const selectedTask = model.snapshot?.tasks.find(task => task.id === model.selectedId && task.objectKind !== 'goal');
  const focusedTask = taskMode && taskFocus && selectedTask ? selectedTask.id : null;
  const queryCenter = taskMode ? focusedTask : model.graphCenter;
  const queryWorkspace = taskMode ? null : model.selectedId;
  const matchingGraph = model.graphLayer === (taskMode ? 'execution' : 'code') ? model.graph : null;
  const graph = taskMode && matchingGraph ? taskFlowView(matchingGraph, focusedTask) : matchingGraph;
  const initialLoading = !!model.root && !graph && !model.graphError;
  const filter = taskMode && (!focusedTask || !['all', 'prerequisites'].includes(model.graphFilter)) ? 'all' : model.graphFilter;
  const input = { workspaceTaskId: queryWorkspace, layer: taskMode ? 'execution' as const : 'code' as const, projectId: model.projectFilter || null, taskId: queryCenter, repositoryId: taskMode ? null : model.repositoryFilter || null, depth: model.graphDepth, offset: 0, limit: 80, kinds: filter === 'prerequisites' ? ['depends_on'] : filter === 'impact' ? ['may_affect'] : [], levels: filter === 'proof' ? ['observed', 'user_confirmed'] : filter === 'stale' ? ['stale'] : [] };
  useEffect(() => { if (model.tab === 'graph' && model.root) void model.loadGraph(input); }, [model.tab, model.root, model.graphMode, queryCenter, queryWorkspace, model.projectFilter, model.repositoryFilter, model.graphDepth, filter, model.snapshot]);
  useEffect(() => { setZoom(1); scroll.current?.scrollTo({ left: 0, top: 0 }); }, [model.graphMode, model.projectFilter, model.graphCenter, taskFocus]);
  useEffect(() => { if (!selectedTask) setTaskFocus(false); }, [selectedTask?.id]);
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const update = () => setCanvasWidth(Math.max(288, element.clientWidth));
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [model.tab, model.graphMode, !!graph?.nodes.length]);
  const selected = model.graphMode === 'architecture' ? model.selectedNode : model.selectedId || model.selectedNode || model.projectFilter;
  const overview = taskMode && !focusedTask;
  const layout = overview ? layoutTaskOverview(graph ?? { nodes: [], relations: [] }, canvasWidth) : layoutTaskGraph(graph ?? { nodes: [], relations: [] }, focusedTask, taskMode);
  function centerSelected() { const p=selected && layout.positions.get(selected), element=scroll.current; if(p && element) element.scrollTo({left:Math.max(0,(p.x+(p.width || 184)/2)*zoom-element.clientWidth/2),top:Math.max(0,(p.y+(p.height || 60)/2)*zoom-element.clientHeight/2)}); }
  const centered = useRef('');
  useEffect(()=>{const key=JSON.stringify([model.root,model.graphMode,selected,focusedTask,canvasWidth]);if(selected && layout.positions.has(selected) && centered.current!==key){centerSelected();centered.current=key;}},[model.root,model.graphMode,selected,focusedTask,canvasWidth,!!(selected && layout.positions.has(selected))]);
  const staleCount = graph?.nodes.filter(n => n.stale).length ?? 0;
  return <div className="tp-graph-panel">
    <header className="tp-graph-bar">
      <Tabs value={model.graphMode} onValueChange={value => { model.setGraphMode(value as 'architecture' | 'task'); model.selectNode(null); model.setGraphCenter(null); }}>
        <TabsList aria-label="图视图" className="h-8"><TabsTrigger value="task">项目执行图</TabsTrigger><TabsTrigger value="architecture">代码结构图</TabsTrigger></TabsList>
      </Tabs>
      <span className="tp-meta tp-graph-summary">{initialLoading ? '正在加载关系图' : model.graphError && !graph ? '关系图读取失败' : focusedTask ? `聚焦 ${taskNumber(selectedTask!)}` : taskMode ? `项目总览 · ${graph?.nodes.filter(node => node.kind === 'task').length ?? 0} 项任务${selectedTask ? ` · 当前 ${taskNumber(selectedTask)}` : ''}` : `${graph?.nodes.length ?? 0}/${graph?.totalNodes ?? 0} 个对象`}{taskMode && graph?.hasMore && ' · 部分任务未加载'}{!taskMode && graph && ` · 图修订 ${graph.graphRevision}`}{staleCount > 0 && ` · 待复核 ${staleCount}`}</span>
      {taskMode ? selectedTask ? <><Button size="sm" variant="ghost" aria-pressed={!!focusedTask} onClick={() => setTaskFocus(!focusedTask)}>{focusedTask ? '返回项目总览' : '聚焦此任务'}</Button><Button size="sm" variant="ghost" onClick={() => document.getElementById('tp-task-records')?.scrollIntoView({ block: 'start' })}>执行与交付</Button></> : <span className="tp-meta">点击任务查看分支与交付</span> : <TaskGraphActions model={model} />}
    </header>
    {model.graphError && <Feedback tone="error" role="alert">{model.graphError}</Feedback>}
    {!graph?.nodes.length ? <div className="tp-graph-state"><EmptyState><GitBranch aria-hidden="true" /><h2>{initialLoading ? '正在加载关系图' : model.graphError ? '关系图暂时无法读取' : !model.root ? '先选择一个仓库' : graph?.hasMore ? '当前已加载范围内没有任务' : taskMode ? '当前范围尚无任务' : '尚无匹配的关系'}</h2><p>{initialLoading ? '正在读取项目与任务，加载完成后会显示在这里。' : model.graphError ? '可以重试读取，已有任务不会丢失。' : graph?.hasMore ? '还有记录尚未加载，请继续加载后查看。' : taskMode ? '新建任务后，它会显示在所属项目下；点击任务可查看分支与交付。' : '可以调整筛选范围，或核对导入代码关系。'}</p>{initialLoading && <span className="sr-only" role="status">正在加载</span>}{model.graphError && <Button variant="outline" disabled={model.graphLoading} onClick={() => void model.loadGraph(input)}>重试读取</Button>}</EmptyState></div> :
      <div className="tp-graph-scroll" ref={scroll} tabIndex={0} aria-label="可平移的关系图"
        onPointerDown={e => { if ((e.target as Element).closest('button')) return; drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) { e.currentTarget.scrollLeft = drag.current.left + drag.current.x - e.clientX; e.currentTarget.scrollTop = drag.current.top + drag.current.y - e.clientY; } }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="tp-graph-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <svg width={layout.width} height={layout.height} aria-label="关系连线">
              {overview && <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="var(--foreground)" /></marker></defs>}
              {graph.relations.map(edge => {
                const d = overview ? taskOverviewPath(edge, layout.positions) : taskGraphPath(edge, layout.positions); if (!d) return null;
                const highlighted = !!selected && (edge.fromId === selected || edge.toId === selected);
                return <path key={edge.id} d={d} className="tp-graph-edge" markerEnd={overview && edge.kind === 'depends_on' ? `url(#${markerId})` : undefined} data-kind={edge.kind} data-level={edge.evidenceLevel} data-highlighted={highlighted} data-dimmed={!!selected && !highlighted}>
                  <title>{graph.nodes.find(n => n.id === edge.fromId)?.label}{taskMode ? edge.kind === 'depends_on' ? ' 需要先完成 ' : ' 包含 ' : ' → '}{graph.nodes.find(n => n.id === edge.toId)?.label} · {taskMode ? '' : `${edge.kind} · `}{levelLabels[edge.evidenceLevel]}</title>
                </path>;
              })}
            </svg>
            {layout.columns.map((column, i) => <div className="tp-graph-column" key={i} style={{ left: column.x }}>{column.label} · {column.count}</div>)}
            {graph.nodes.map(node => {
              const position = layout.positions.get(node.id)!, task = model.snapshot?.tasks.find(t => t.id === node.id);
              const subtitle = task ? `${taskNumber(task)} · ${laneLabels[task.lane]}` : taskMode && node.kind === 'project' ? '项目总控' : `${node.path ? node.path.replaceAll('\\', '/').split('/').pop() : graphKindName(node.kind)} · ${levelLabels[node.evidenceLevel]}`;
              const git = task && taskGit(task, model.snapshot), branch = task && (git?.branch || task.executionWorkspace?.branch);
              const branchLabel = task && task.objectKind !== 'goal' ? task.executionWorkspace || task.repositoryId ? branch || '分支待同步' : '无代码工作区' : '';
              return <Card key={node.id} className="tp-graph-position p-0 gap-0" data-selected={selected === node.id} style={{ left: position.x, top: position.y, width: position.width }}>
                <Button variant="app-control" className="tp-graph-node" data-task-flow={taskMode} aria-pressed={selected === node.id} title={`${node.label}\n${subtitle}${taskMode && branchLabel ? `\n${branchLabel}${task?.repositoryId || task?.executionWorkspace ? ` · ${gitStatus(git)}\n${task?.executionWorkspace?.path || git?.path || ''}` : ''}` : ''}${node.stale ? '\n出处已变 · 待复核' : ''}`} onClick={() => { if (taskMode && node.kind === 'project') { setTaskFocus(false); model.select(null); model.selectNode(node.id); } else { model.selectNode(node.id); if (task) model.select(task.id); } }}>
                  <strong>{node.label}</strong><span>{subtitle}</span>{taskMode && branchLabel && <span className="tp-graph-branch"><GitBranch size={12} aria-hidden="true" /><span>{branchLabel}</span>{(task?.repositoryId || task?.executionWorkspace) && <small>{compactGitStatus(git)}</small>}</span>}{node.stale && <i className="tp-dot tp-tone-warning tp-graph-stale" aria-label="出处已变，待复核" />}
                </Button>
              </Card>;
            })}
          </div>
        </div>
      </div>}
    <footer className="tp-graph-footer">
      <div className="tp-graph-legend"><span><i className="tp-graph-key-dependency" />明确前置</span><span><i />{taskMode ? '项目与目标归属' : '已登记关联'}</span>{!taskMode && <span><i className="tp-graph-key-candidate" />静态影响候选</span>}</div>
      <div className="tp-graph-tools">
        {!overview && <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="关系图筛选"><SlidersHorizontal />筛选{filter !== 'all' && ' · 已启用'}</Button></PopoverTrigger><PopoverContent className="grid gap-4" align="end">
          <Label className="grid gap-2">关系分类<NativeSelect variant="app" aria-label="关系分类" value={filter} onChange={e => model.setGraphFilter(e.target.value)}><option value="all">{taskMode ? '任务依赖与归属' : '全部关系'}</option><option value="prerequisites">明确前置</option>{!taskMode && <><option value="proof">程序观察与本人核对</option><option value="impact">静态影响候选</option><option value="stale">出处已变 · 待复核</option></>}</NativeSelect></Label>
          {(!taskMode || focusedTask) && <Label className="grid gap-2">关系展开深度<NativeSelect variant="app" aria-label="关系展开深度" value={model.graphDepth} onChange={e => model.setGraphDepth(Number(e.target.value))}>{[1, 2, 3, 4].map(d => <option key={d} value={d}>展开 {d} 层</option>)}</NativeSelect></Label>}
        </PopoverContent></Popover>}
        <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost">{taskMode ? '显示范围' : `范围与未知 · ${graph?.unknowns.length ?? 0}`}</Button></PopoverTrigger><PopoverContent className="w-96 max-w-[calc(100vw-32px)] max-h-80 overflow-auto text-sm" align="end"><h3 className="font-semibold">{taskMode ? '任务关系范围' : '范围与未知项'}</h3><p className="tp-meta mt-2">当前展示 {graph?.nodes.length ?? 0}/{graph?.totalNodes ?? 0} 个对象。{taskMode ? focusedTask ? `按 ${model.graphDepth} 层展开此任务的前置与下游；点击“返回项目总览”可查看其他任务。` : '按项目、目标与阶段归属展示任务。选择任务仅高亮并打开详情；粗线箭头表示已登记的前置关系。' : '连线表示已登记关系，实际方向与来源可点节点核对。'}</p>{graph?.unknowns.map((s, i) => <p className="mt-3" key={i}>{s}</p>)}{taskMode ? <p className="tp-meta mt-3">图修订 {graph?.graphRevision ?? '—'}{graph?.hasMore && ' · 部分任务尚未加载，请继续加载'}</p> : <details className="mt-3"><summary>查看覆盖记录</summary><pre className="tp-source">{JSON.stringify(graph?.coverage ?? [], null, 2)}</pre></details>}</PopoverContent></Popover>
        <Button size="icon-sm" variant="ghost" disabled={!selected || !layout.positions.has(selected)} aria-label="定位当前选择的任务或对象" onClick={centerSelected}><LocateFixed /></Button><Button size="icon-sm" variant="ghost" aria-label="缩小关系图" onClick={() => setZoom(z => Math.max(.5, z - .1))}><Minus /></Button><span className="tp-mono tp-meta">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="放大关系图" onClick={() => setZoom(z => Math.min(1.8, z + .1))}><Plus /></Button><Button size="sm" variant="ghost" onClick={() => { setZoom(1); scroll.current?.scrollTo({ left: 0, top: 0 }); }}>重置视图</Button>
        {graph?.hasMore && <Button size="sm" variant="outline" disabled={model.graphLoading} onClick={() => void model.loadGraph({ ...input, offset: model.graph?.nodes.length || 0 }, true)}>继续加载</Button>}
      </div>
    </footer>
  </div>;
}
