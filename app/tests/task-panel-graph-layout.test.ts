import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTaskGraph, taskGraphPath } from '../src/task-panel-graph-layout.ts';
import type { GraphNode, Relation } from '../src/task-panel-contract.ts';
const node = (id: string, kind = 'file'): GraphNode => ({id,kind,label:id,repositoryId:null,path:'',symbol:'',evidenceLevel:'fixture',sources:[],stale:false});
const edge = (fromId: string, toId: string, kind = 'imports'): Relation => ({id:fromId+toId+kind,fromId,toId,kind,threshold:'none',source:'fixture',evidenceLevel:'fixture',active:true,revision:1});

test('Given 依赖和循环关系 When 按列展示 Then 前置在左且循环有限展开不丢节点', () => {
  const graph = {nodes:[node('dependent','task'),node('prerequisite','task'),node('a'),node('b')],relations:[edge('dependent','prerequisite','depends_on'),edge('a','b'),edge('b','a')]};
  const result=layoutTaskGraph(graph);
  assert(result.positions.get('prerequisite')!.x<result.positions.get('dependent')!.x);
  assert.equal(result.positions.get('a')!.x,result.positions.get('b')!.x);
  assert.equal(result.positions.size,4);assert(result.width<1000);
  const loop=taskGraphPath(edge('a','b'),result.positions);assert(!loop.includes('NaN'));
  assert.equal(graph.relations[0].fromId,'dependent');
});
test('Given 反向影响候选 When 安排代码层级 Then 不把候选变成结构依赖或丢弃连线', () => {
  const graph={nodes:[node('entry'),node('util')],relations:[edge('entry','util'),edge('util','entry','may_affect')]};
  const result=layoutTaskGraph(graph);assert(result.positions.get('entry')!.x<result.positions.get('util')!.x);
  assert(taskGraphPath(graph.relations[1],result.positions).includes('C'));
  assert.equal(graph.relations.length,2);
});
test('Given 焦点任务与前置下游 When 展开邻域 Then 当前任务保持独立列且每个对象只出现一次', () => {
  const result=layoutTaskGraph({nodes:['before','now','after','proof'].map(id=>node(id,'task')),relations:[edge('now','before','depends_on'),edge('after','now','depends_on')]},'now');
  assert.deepEqual(['before','now','after','proof'].map(id=>result.positions.get(id)!.column),[0,1,2,3]);
  assert.equal(result.positions.size,4);
});
test('Given 跨列连线与缺失端点 When 生成曲线 Then 避开中间卡片且缺失端点不造假对象', () => {
  const result=layoutTaskGraph({nodes:['a','b','c'].map(id=>node(id)),relations:[edge('a','b'),edge('b','c'),edge('a','c')]});
  const curve=taskGraphPath(edge('a','c'),result.positions);assert(curve.includes(',40'));assert(!curve.includes('NaN'));
  assert.equal(taskGraphPath(edge('a','absent'),result.positions),'');
  assert.equal(result.positions.size,3);
});
