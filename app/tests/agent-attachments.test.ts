import assert from 'node:assert/strict';
import test from 'node:test';
import { messageView, imagePreviewUrl } from '../src/pi-messages.ts';
import { agentMessageAttachments } from '../src/agent-message-content.ts';
import { conversationView } from '../src/pi-process-view.ts';
import type { PiProjection } from '../src/pi-client.ts';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZmcAAAAASUVORK5CYII=';

test('Given 原生用户图片，When 恢复聊天记录，Then 图片保留可用预览且按原顺序显示',()=>{
  const view=messageView({role:'user',content:[{type:'text',text:'核对截图'},{type:'image',mimeType:'image/png',data:png}]});
  assert.equal(view.parts[0].text,'核对截图');assert.equal(view.parts[1].imageUrl,`data:image/png;base64,${png}`);assert.equal(view.parts[1].text,'图片');
});
test('Given 错误类型、伪装媒体或超限载荷，When 生成预览，Then 不生成可执行URL',()=>{
  for(const [mime,data] of [['image/svg+xml',png],['image/jpeg',png],['image/png','javascript:alert(1)'],['image/png',png+'!'],['image/png','A'.repeat(4*1024*1024+4)]])assert.equal(imagePreviewUrl(mime,data),undefined);
});
test('Given 文件上下文，When 展示发送附件，Then 只返回缩略图需要的信息而不暴露路径和哈希',()=>{
  const context={version:1,inputId:'input',conversationKey:'conversation',source:{module:'projects'},objects:[],attachments:[{id:'file',name:'镜头表.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:2048,path:'private-fixture-path',hash:'private-hash'}]};
  const files=agentMessageAttachments(`核对\n\n\`\`\`azcine-context\n${JSON.stringify(context)}\n\`\`\``);
  assert.deepEqual(files,[{id:'file',name:'镜头表.xlsx',mimeType:context.attachments[0].mimeType,bytes:2048}]);assert.deepEqual(agentMessageAttachments('用户自己写的文件名'),[]);
});
test('Given 工具过程与分段回答，When 定位回复中的草案，Then 保留原生消息序号避免草案挂到另一轮',()=>{
  const projection={messages:[{role:'user',content:'请求'},{role:'assistant',stopReason:'stop',content:[{type:'thinking',thinking:'过程'},{type:'text',text:'回答'},{type:'text',text:'草案'}]}],partial:null,tools:[],steering:[],followUp:[],activity:'idle',outcome:'success',notice:null} as PiProjection;
  const messages=conversationView(projection,'test').filter(item=>item.kind==='message');assert.deepEqual(messages.map(item=>item.messageIndex),[0,1]);
  assert.deepEqual(messages[1].parts.map(part=>part.text),['回答','草案']);
});
