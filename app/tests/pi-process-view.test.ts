import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationView, processHasIssue } from '../src/pi-process-view.ts';
import type { ProcessView, ToolView } from '../src/pi-process-view.ts';
import type { PiProjection } from '../src/pi-client.ts';
import { messageView } from '../src/pi-messages.ts';
const projection=(extra:Partial<PiProjection>={}):PiProjection=>({messages:[],partial:null,tools:[],steering:[],followUp:[],activity:'idle',outcome:'none',notice:null,...extra});
const thinking=(text='公开思考')=>({type:'thinking',thinking:text,redacted:null});
const call=(id:string,name='read')=>({type:'toolCall',id,name,arguments:{path:id+'.md'}});
const assistant=(content:unknown[],stopReason='toolUse')=>({role:'assistant',content,stopReason});
const result=(id:string,isError=false)=>({role:'toolResult',toolCallId:id,toolName:'read',isError,content:[{type:'text',text:isError?'真实错误':'真实输出'}]});
const processes=(p:PiProjection)=>conversationView(p,'root/session/1').filter((x):x is ProcessView=>x.kind==='process');
const tools=(p:PiProjection)=>processes(p).flatMap(x=>x.entries.filter((e):e is ToolView=>e.kind==='tool'));

test('Given 历史工具清单为空 When 恢复调用与结果 Then 按ID关联一次展示且保留两次同名调用',()=>{
  const p=projection({messages:[assistant([thinking(),call('a'),call('b')]),result('b'),result('a'),assistant([{type:'text',text:'最终正文'}],'stop')]});
  const rows=tools(p);assert.deepEqual(rows.map(x=>x.id),['a','b']);assert.ok(rows.every(x=>x.output==='真实输出'&&x.status==='success'));
  assert.equal(conversationView(p,'context').filter(x=>x.kind==='message').length,1);
});
test('Given 多次增量与消息结果 When 同一调用结束 Then 不重复行且使用真实错误状态',()=>{
  const p=projection({messages:[assistant([call('a')]),result('a',true)],tools:[{id:'a',name:'read',status:'finished',result:{content:[{type:'text',text:'旧增量'}]}}]});
  assert.equal(tools(p).length,1);assert.equal(tools(p)[0].output,'真实错误');assert.equal(tools(p)[0].status,'error');assert.ok(processHasIssue(processes(p)[0]));
});
test('Given partial转正式消息 When 同位置内容结束 Then 展示标识保持稳定而重连会话不串',()=>{
  const partial=assistant([thinking(),call('a')],'pending');
  const first=conversationView(projection({partial,activity:'running'}),'root/A/1');
  const last=conversationView(projection({messages:[partial,result('a')]}),'root/A/1');
  assert.equal(first[0].key,last[0].key);assert.notEqual(first[0].key,conversationView(projection({partial}),'root/B/1')[0].key);
  assert.notEqual(first[0].key,conversationView(projection({partial}),'root/A/2')[0].key);
});
test('Given 中间助手正文穿插过程 When 展示 Then 在同一过程保留执行说明和次序且最终回复独立',()=>{
  const p=projection({messages:[assistant([thinking('先思考'),{type:'text',text:'先说明限制'},call('a')]),result('a'),assistant([{type:'text',text:'最终正文'}],'stop')]});
  const items=conversationView(p,'context');assert.deepEqual(items.map(x=>x.kind),['process','message']);
  assert.ok(items[0].kind==='process');assert.deepEqual(items[0].entries.map(entry=>entry.kind),['thinking','commentary','tool']);
  assert.equal(items[0].entries[1].kind==='commentary'&&items[0].entries[1].text,'先说明限制');
  assert.equal(items[1].kind==='message'&&items[1].parts[0].text,'最终正文');
});
test('Given 孤立工具事件或历史结果 When 缺调用位置 Then 保留内容并标明无法关联',()=>{
  const p=projection({messages:[result('orphan')],tools:[{id:'live-only',name:'unknown_native_tool',status:'running',args:{path:'native.md'}}],activity:'running'});
  const items=conversationView(p,'context');assert.ok(items[0].kind==='message'&&items[0].title.includes('未关联调用'));
  assert.equal(tools(p)[0].notice,'仅有工具事件，原消息位置未记录。');assert.equal(tools(p)[0].status,'running');
});
test('Given ID冲突 When 结果无法唯一归属 Then 保留冲突提示和原结果不误合并',()=>{
  const p=projection({messages:[assistant([call('a'),call('a')]),result('a')]});
  assert.ok(tools(p).every(x=>x.notice?.includes('ID重复')&&x.output===''));
  assert.ok(conversationView(p,'context').some(x=>x.kind==='message'&&x.role==='toolResult'));
});
test('Given 无结束结果 When 查看历史调用 Then 不伪造完成或进行中',()=>{
  const row=tools(projection({messages:[assistant([call('a')])]}))[0];assert.equal(row.status,'incomplete');assert.equal(row.output,'');
});
test('Given 仅思考消息被中断 When 历史折叠 Then 异常仍有可识别标记',()=>{
  const p=projection({messages:[assistant([thinking()],'aborted')],outcome:'interrupted'});
  assert.ok(processHasIssue(processes(p)[0]));assert.ok(processes(p)[0].errors.some(x=>x.includes('中断')));
});
test('Given Rust省略遮蔽字段或已遮蔽内容 When 展示 Then 正常思考可读且不还原隐私文本',()=>{
  assert.equal(messageView(assistant([thinking()],'pending')).parts[0].text,'公开思考');
  const view=messageView(assistant([{type:'thinking',thinking:'不得展示的内容',redacted:true,signature:'不得展示的签名'}],'pending'));
  assert.equal(view.parts[0].text,'思考内容已遮蔽。');assert.ok(!JSON.stringify(view).includes('不得展示'));
});
test('Given 工具已结束但运行未settled When 等后续回复或停止压缩 Then 当前过程保持活动历史不误标',()=>{
  const messages=[assistant([thinking('历史')],'stop'),{role:'user',content:[{type:'text',text:'新任务'}]},assistant([call('new')]),result('new')];
  for(const activity of ['running','stopping','compacting']){
    const items=conversationView(projection({messages,activity,tools:[{id:'new',name:'read',status:'finished'}]}),'root/session/1',2);
    const groups=items.filter((x):x is ProcessView=>x.kind==='process');assert.equal(groups[0].live,false);assert.equal(groups[1].live,true);
    assert.equal(groups[1].activity,activity);
  }
  assert.equal(conversationView(projection({messages,activity:'idle'}),'context',2).filter((x):x is ProcessView=>x.kind==='process').at(-1)?.live,false);
});
test('Given 历史length正文或纯思考 When 恢复 Then 留未完整标记且普通toolUse不误判异常',()=>{
  const text=conversationView(projection({messages:[assistant([{type:'text',text:'被截断的正文'}],'length')]}),'context');
  assert.ok(text[0].kind==='message'&&text[0].status==='incomplete');
  assert.ok(processHasIssue(processes(projection({messages:[assistant([thinking()],'length')]}))[0]));
  assert.ok(!processHasIssue(processes(projection({messages:[assistant([thinking(),call('a')]),result('a')]}))[0]));
});
