import test from 'node:test';
import assert from 'node:assert/strict';
import {agentMessageContent} from '../src/agent-message-content.ts';

const context={version:1,inputId:'fixture-input',conversationKey:'fixture-conversation',source:{module:'today'},objects:[],attachments:[{name:'交付清单.csv'}]};
const envelope=(value:unknown)=>'\n\n```azcine-context\n'+JSON.stringify(value)+'\n```';
test('Given应用自动附加上下文 When显示用户消息 Then只显示原文与真实文件名',()=>{
  assert.deepEqual(agentMessageContent('你好'+envelope(context)),{text:'你好',files:['交付清单.csv']});
});
test('Given用户输入代码或畸形上下文 When显示消息 Then原文完整保留',()=>{
  for(const text of ['普通消息','示例\n```azcine-context\n{}\n```','用户代码'+envelope({version:1}),'保留\n\n```azcine-context\n{bad}\n```','未结束\n\n```azcine-context\n{}','后续正文'+envelope(context)+'\n这是用户正文']) assert.equal(agentMessageContent(text).text,text);
});
test('Given正文含前置代码而末尾有有效传输数据 When显示消息 Then仅移除末尾自动数据',()=>{
  const original='介绍标记：\n```azcine-context\n示例\n```\n\n继续写正文';
  assert.equal(agentMessageContent(original+envelope(context)).text,original);
});
test('Given上游无法发送图片的注记 When显示应用上下文 Then保留失败提示而不展开技术数据',()=>{
  const content=agentMessageContent('核对截图'+envelope(context)+'\n\n[Image omitted: could not be resized below the inline image size limit.]');
  assert.equal(content.text,'核对截图\n\n图片未能发送，请重新导入有效图片后再试。');assert.deepEqual(content.files,['交付清单.csv']);
});

test('assistant draft display folds one valid proposal and preserves malformed originals',async()=>{
 const {assistantDraftContent}=await import('../src/agent-message-content.ts');
 const block='建议如下\n\n```azcine-draft\n'+JSON.stringify({version:1,operations:[],decisions:[]})+'\n```';
 assert.equal(assistantDraftContent(block).text,'建议如下');assert.ok(assistantDraftContent(block).draft);
 const invalid='```azcine-draft\nnot-json\n```';assert.deepEqual(assistantDraftContent(invalid),{text:invalid,draft:null});
});
