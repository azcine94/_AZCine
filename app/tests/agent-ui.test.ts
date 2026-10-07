import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExtensionUi} from '../src/pi-client.ts';
const ui=()=>({requests:[{id:'fixture-question',method:'select',title:'选一项',message:'',options:['继续','停止'],placeholder:'',prefill:'',status:'pending',expiresAt:null}],statuses:{task:'等待回答'},widgets:{task:{lines:['明确测试'],placement:'belowEditor'}},notifications:[],title:null,editor:null});
test('Given完整原生扩展UI记录 When解析 Then问题ID选项位置完整保留',()=>{const value=parseExtensionUi(ui())!;assert.equal(value.requests[0].id,'fixture-question');assert.deepEqual(value.requests[0].options,['继续','停止']);assert.equal(value.widgets.task.placement,'belowEditor');});
test('Given重复ID未知方法或错误选项结构 When解析 Then拒绝畸形UI快照',()=>{const duplicate=ui();duplicate.requests.push({...duplicate.requests[0]});assert.throws(()=>parseExtensionUi(duplicate));assert.throws(()=>parseExtensionUi({...ui(),requests:[{...ui().requests[0],method:'spawn'}]}));assert.throws(()=>parseExtensionUi({...ui(),requests:[{...ui().requests[0],options:[1]}]}));assert.throws(()=>parseExtensionUi({...ui(),widgets:{task:{lines:[null],placement:'belowEditor'}}}));});
