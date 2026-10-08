import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFor, emptyIdeaDraft, filterIdeas, ideaDraft, parseIdea, parseIdeas, validateIdea } from '../src/ideas-contract.ts';
import { navigationPage, pageTitle, resolveRoute, sourceTarget } from '../src/routes.ts';
const id='22222222-2222-2222-2222-222222222222';
const raw={id,title:'雨夜港口',body:'先显出反光\n再显出船体',tags:['画面','灯光'],projectId:null,revision:1,createdAt:'2026-10-04T01:00:00Z',updatedAt:'2026-10-04T01:00:00Z',deleted:false,todoId:null};
test('Given 空内容/重复标签 When提交 Then阻止保存；合法内容允许无标题/公司/日期',()=>{
 assert.ok(validateIdea(emptyIdeaDraft())); assert.ok(validateIdea({...emptyIdeaDraft(),body:'内容',tags:'灯光，灯光'}));
 assert.equal(validateIdea({...emptyIdeaDraft(),body:'内容',tags:'灯光，画面'}),null);
 assert.deepEqual(contentFor(id,{...emptyIdeaDraft(),body:' 内容 ',tags:'灯光，画面'}),{id,title:'',body:'内容',tags:['灯光','画面'],projectId:null});
});
test('Given 灵感 When搜索/标签/公司筛选 Then组合生效且已移除分开',()=>{
 const a=parseIdea(raw),b=parseIdea({...raw,id:'33333333-3333-3333-3333-333333333333',title:'流程',tags:['工具'],projectId:id}),c={...a,id:'44444444-4444-4444-4444-444444444444',deleted:true};
 assert.deepEqual(filterIdeas([a,b,c],'反光','画面','',false),[a]);assert.deepEqual(filterIdeas([a,b,c],'','工具',id,false),[b]);
 assert.equal(filterIdeas([a,b,c],'无结果','','',false).length,0);assert.deepEqual(filterIdeas([a,b,c],'','','',true),[c]);
});
test('Given 畸形IPC/重复编号 When读取 Then拒绝替换；草稿转化保留换行及关联',()=>{
 assert.throws(()=>parseIdea({...raw,revision:0}));assert.throws(()=>parseIdea({...raw,todoId:'bad'}));assert.throws(()=>parseIdeas([raw,raw]));
 assert.equal(ideaDraft(parseIdea(raw)).body,raw.body);
});
test('Given 转待办或来源回链 When打开 Then路由解析到正确模块及原编号',()=>{
 const route=resolveRoute(`#ideas/${id}`);assert.equal(navigationPage(route),'ideas');assert.equal(sourceTarget(route),id);assert.equal(pageTitle(route),'灵感');
 const retired=resolveRoute(`#today/${id}`);assert.equal(retired,'today');assert.equal(sourceTarget(retired),null);assert.equal(pageTitle(retired),'今天');
 assert.equal(resolveRoute('#ideas/invalid'),'missing');
});
