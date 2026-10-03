import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectContent, parseProject, parseProjects, deriveDeliveries, ensureDeliveryColumns, deleteRow, deleteColumn, deleteBlock, restoreUndo } from '../src/projects-contract.ts';
import type { ProjectContent, ListBlock, ColumnKind } from '../src/projects-contract.ts';
import { resolveRoute, navigationPage, projectTarget, pageTitle } from '../src/routes.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
function fixture(offset=0):ProjectContent {
  const uid=(n:number)=>id(n+offset), kinds:ColumnKind[]=['shot','stage','date','delivered','text'];
  return {id:uid(1),name:'雾港',labels:[{id:uid(2),name:'ACOPY'},{id:uid(3),name:'FINAL'}],blocks:[
    {id:uid(10),kind:'list',title:'交片表',included:true,columns:kinds.map((kind,index)=>({id:uid(11+index),name:kind,kind})),rows:[{id:uid(20),cells:{[uid(11)]:'SH010',[uid(12)]:uid(2),[uid(13)]:'2027-01-05',[uid(14)]:'false',[uid(15)]:'原备注'}}]},
    {id:uid(30),kind:'text',title:'自由文字',body:'原始多日期 2026-12-30 / 2027-01-05'},
    {id:uid(31),kind:'checklist',title:'核对',items:[{id:uid(32),text:'自由清单',checked:false}]}
  ]};
}
function list(content:ProjectContent,blockId=id(10)):ListBlock { const block=content.blocks.find(item=>item.id===blockId);assert.ok(block?.kind==='list');return block; }
const document=(content=fixture())=>({...content,revision:1,createdAt:'2026-10-03T00:00:00.000Z'});
const columnIds=()=>({shot:id(101),stage:id(102),date:id(103),delivered:id(104)});
function frozen<T>(value:T):T { if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value; }

test('Given完整自由文档 When解析 Then返回独立副本且空项目不暗建标签',()=>{
  const raw=frozen(document()), result=parseProject(raw);assert.deepEqual(result,raw);assert.notEqual(list(result).rows[0].cells,list(raw).rows[0].cells);
  assert.deepEqual(parseProjectContent({id:id(1),name:'空',labels:[],blocks:[]}).labels,[]);
  assert.deepEqual(parseProjects([]),[]);assert.throws(()=>parseProjects([raw,raw]));
});
test('Given非法结构引用日期或重复ID When解析 Then整份拒绝不猜值',()=>{
  for(const value of [null,undefined,{},[],new Date()])assert.throws(()=>parseProject(value));
  const mutations:((p:ProjectContent)=>void)[]=[
    p=>{p.name=' ';},p=>{p.name='\ud800';},p=>{p.labels[1].name=' ACOPY ';},p=>{p.labels[0].id=p.id;},
    p=>{list(p).rows[0].id=id(11);},p=>{list(p).columns[1].kind='shot';},
    p=>{list(p).rows[0].cells[id(999)]='未知列';},p=>{list(p).rows[0].cells[id(12)]=id(1002);},
    p=>{list(p).rows[0].cells[id(13)]='2026-02-29';},p=>{list(p).rows[0].cells[id(13)]='01-05';},
    p=>{list(p).rows[0].cells[id(14)]='TRUE';},p=>{Object.assign(p,{unexpected:true});},
  ];
  for(const mutate of mutations){const p=fixture();mutate(p);const before=structuredClone(p);assert.throws(()=>parseProjectContent(frozen(p)));assert.deepEqual(p,before);}
  for(const revision of [0,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parseProject({...document(),revision}));
  const leap=fixture();list(leap).rows[0].cells[id(13)]='2028-02-29';assert.doesNotThrow(()=>parseProjectContent(leap));
});
test('Given字符数量字节边界 When解析 Then边界通过超界拒绝且不截断',()=>{
  const builders:[number,(n:number)=>ProjectContent][]=[
    [200,n=>({...fixture(),name:'🎬'.repeat(n)})],
    [80,n=>{const p=fixture();p.labels[0].name='字'.repeat(n);return p;}],
    [100,n=>({...fixture(),labels:[...fixture().labels,...Array.from({length:n-2},(_,i)=>({id:id(200+i),name:`阶段${i}`}))]})],
    [200,n=>({...fixture(),blocks:Array.from({length:n},(_,i)=>({id:id(200+i),kind:'text',title:'段落',body:''}))})],
    [100000,n=>({...fixture(),blocks:[{id:id(30),kind:'text',title:'段落',body:'字'.repeat(n)}]})],
    [64,n=>{const p=fixture();list(p).columns=Array.from({length:n},(_,i)=>({id:id(200+i),kind:'text',name:'列'}));list(p).rows=[];return p;}],
    [10000,n=>{const p=fixture();list(p).rows=Array.from({length:n},(_,i)=>({id:id(200+i),cells:{}}));return p;}],
    [200,n=>{const p=fixture();list(p).rows[0].cells[id(11)]='字'.repeat(n);return p;}],
    [10000,n=>{const p=fixture();list(p).rows[0].cells[id(15)]='字'.repeat(n);return p;}],
    [10000,n=>({...fixture(),blocks:[{id:id(31),kind:'checklist',title:'清单',items:[{id:id(32),text:'字'.repeat(n),checked:false}]}]})],
  ];
  for(const [max,build]of builders){assert.doesNotThrow(()=>parseProjectContent(build(max)));assert.throws(()=>parseProjectContent(build(max+1)));}
  const huge=fixture();huge.blocks=Array.from({length:56},(_,i)=>({id:id(200+i),kind:'text',title:'大段落',body:'中'.repeat(100000)}));assert.throws(()=>parseProjectContent(huge),/16 MiB/);
});
test('Given一镜头行 When分别切FINAL改日期交完恢复 Then字段独立且行ID数量不变',()=>{
  const p=fixture(),row=list(p).rows[0];row.cells[id(12)]=id(3);let derived=deriveDeliveries([p]);
  assert.equal(derived[0].stageName,'FINAL');assert.equal(derived[0].dueDate,'2027-01-05');assert.equal(derived[0].rowId,id(20));
  row.cells[id(13)]='2028-01-06';assert.equal(deriveDeliveries([p])[0].stageId,id(3));
  row.cells[id(13)]='';assert.deepEqual(deriveDeliveries([p])[0].missing,['dueDate']);
  row.cells[id(14)]='true';assert.equal(deriveDeliveries([p]).length,0);row.cells[id(14)]='false';assert.equal(deriveDeliveries([p]).length,1);assert.equal(list(p).rows.length,1);
});
test('GivenA和B项目标签 WhenA改名 ThenB不变并拒绝跨项目引用',()=>{
  const a=fixture(),b=fixture(1000);a.labels[0].name='A阶段';const derived=deriveDeliveries(parseProjects([document(a),document(b)]));
  assert.deepEqual(derived.map(item=>item.stageName),['A阶段','ACOPY']);list(a).rows[0].cells[id(12)]=b.labels[0].id;assert.throws(()=>parseProjectContent(a));
});
test('Given指定与普通表及缺字段跨年 When汇总 Then只指定表稳定按日期排序无日期最后',()=>{
  const p=fixture(), b=list(p);b.rows.push({id:id(21),cells:{}},{id:id(22),cells:{[id(11)]:'SH020',[id(13)]:'2026-12-31'}});
  p.blocks.push({...structuredClone(b),id:id(40),included:false,columns:[],rows:[{id:id(41),cells:{}}]});
  const results=deriveDeliveries([parseProjectContent(p)]);assert.deepEqual(results.map(row=>row.rowId),[id(22),id(20),id(21)]);assert.deepEqual(results[2].missing,['shot','stageId','dueDate']);
  const copy=fixture(1000);assert.deepEqual(deriveDeliveries([fixture(),copy]).map(row=>row.projectId),[id(1),id(1001)]);
});
test('Given行被删除且其他文字改动 When撤销 Then仅恢复原行并保留手改与原始位置',()=>{
  const p=fixture();list(p).rows.push({id:id(21),cells:{}});const before=structuredClone(p);const deleted=deleteRow(frozen(p),id(10),id(20));
  deleted.content.name='改过项目名';const restored=restoreUndo(deleted.content,deleted.undo);
  assert.equal(restored.name,'改过项目名');assert.deepEqual(list(restored).rows,list(before).rows);assert.deepEqual(p,before);
  assert.throws(()=>restoreUndo(restored,deleted.undo),/占用/);
});
test('Given被删行依赖列标签已消失 When撤销 Then拒绝而不是丢字段恢复',()=>{
  const deleted=deleteRow(fixture(),id(10),id(20));const noColumn=deleteColumn(deleted.content,id(10),id(13));assert.throws(()=>restoreUndo(noColumn.content,deleted.undo),/引用/);
  deleted.content.labels=[];assert.throws(()=>restoreUndo(deleted.content,deleted.undo),/标签/);
  const noList=deleteBlock(deleteRow(fixture(),id(10),id(20)).content,id(10));assert.throws(()=>restoreUndo(noList.content,deleted.undo),/list/);
});
test('Given语义列删除后补空列 When撤销 Then恢复原列原值且新行保持空不重建已删行',()=>{
  const p=fixture();list(p).rows.push({id:id(21),cells:{[id(13)]:'2028-01-01'}});const deleted=deleteColumn(frozen(p),id(10),id(13));
  const b=ensureDeliveryColumns(list(deleted.content),columnIds());b.rows=b.rows.filter(row=>row.id!==id(21));b.rows.push({id:id(23),cells:{}});deleted.content.blocks[0]=b;
  const restored=restoreUndo(deleted.content,deleted.undo), table=list(restored);assert.ok(table.columns.some(c=>c.id===id(13)));assert.ok(!table.columns.some(c=>c.id===id(103)));
  assert.equal(table.rows[0].cells[id(13)],'2027-01-05');assert.equal(table.rows[1].cells[id(13)],undefined);assert.ok(!table.rows.some(row=>row.id===id(21)));
});
test('Given补回语义列已有新值 When撤销 Then保留冲突值且清空后可重试',()=>{
  const deleted=deleteColumn(fixture(),id(10),id(13));deleted.content.blocks[0]=ensureDeliveryColumns(list(deleted.content),columnIds());list(deleted.content).rows[0].cells[id(103)]='2029-01-01';
  const before=structuredClone(deleted.content);assert.throws(()=>restoreUndo(frozen(deleted.content),deleted.undo),/新值/);assert.deepEqual(deleted.content,before);
  const cleared=structuredClone(before);list(cleared).rows[0].cells[id(103)]='';assert.equal(list(restoreUndo(cleared,deleted.undo)).rows[0].cells[id(13)],'2027-01-05');
});
test('Given内容块删除和语义补列 When恢复 Then检查嵌套ID引用与64列上限不原地修改',()=>{
  const p=fixture(),deleted=deleteBlock(frozen(p),id(10));assert.deepEqual(restoreUndo(deleted.content,deleted.undo),p);
  deleted.content.labels=[];assert.throws(()=>restoreUndo(deleted.content,deleted.undo));
  const empty:ListBlock={id:id(10),kind:'list',title:'空表',included:false,columns:[],rows:[]};const full=ensureDeliveryColumns(frozen(empty),columnIds());assert.equal(full.included,true);assert.equal(full.columns.length,4);assert.equal(empty.columns.length,0);
  assert.deepEqual(ensureDeliveryColumns(full,columnIds()),full);
  assert.throws(()=>ensureDeliveryColumns(empty,{...columnIds(),date:id(10)}));
  const max={...empty,columns:Array.from({length:64},(_,i)=>({id:id(200+i),name:'列',kind:'text' as const}))};assert.throws(()=>ensureDeliveryColumns(max,columnIds()),/64/);
});
test('Given公司深链接 When解析导航 Then定位稳定项目块行而未知路径仍拒绝',()=>{
  const route=resolveRoute(`#projects/${id(1)}/${id(10)}/${id(20)}`);assert.equal(navigationPage(route),'projects');assert.equal(pageTitle(route),'公司文档');
  assert.deepEqual(projectTarget(route),{projectId:id(1),row:{blockId:id(10),rowId:id(20)}});
  for(const hash of ['#projects/unknown',`#projects/${id(1)}/broken`,'#research'])assert.equal(resolveRoute(hash),'missing');
});
