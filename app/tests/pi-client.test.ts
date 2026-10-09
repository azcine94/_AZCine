import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,parseSessions,piError} from '../src/pi-client.ts';
function snapshot(){return {generation:1,seq:2,connection:'ready',busy:false,stopping:false,sending:false,state:{sessionId:'fixture',sessionFile:'Z:/fixture/native.jsonl',sessionName:null,model:{id:'unknown',provider:'unknown',api:'unknown',baseUrl:'',reasoning:false,input:[],contextWindow:0,maxTokens:0},thinkingLevel:'off',isStreaming:false,isCompacting:false,pendingMessageCount:0,messageCount:0},models:[],projection:{messages:[],partial:null,tools:[],steering:[],followUp:[],activity:'idle',outcome:'none',notice:null},recoveredQueue:['未发送'],error:null,notice:null,cwd:null,runtime:null,paths:null};}
test('Multiple loaded context files keep the Agent snapshot readable',()=>{
  const files=[{path:'Z:/fixture/AGENTS.md',hash:'fixture',status:'loaded'}];
  assert.deepEqual(parseSnapshot({...snapshot(),rules:{status:'loaded',files}}).rules?.files,files);
  assert.equal(parseSnapshot({...snapshot(),rules:{status:'missing',files:[]}}).rules?.status,'missing');
});
test('Given empty native models When parsing snapshot Then ready is not a usable model and drafts are not fabricated',()=>{const result=parseSnapshot(snapshot());assert.equal(result.connection,'ready');assert.equal(result.state?.model,null);assert.deepEqual(result.models,[]);assert.deepEqual(result.projection.messages,[]);assert.deepEqual(result.recoveredQueue,['未发送']);});
test('Given malformed snapshot When parsing Then refuse missing arrays flags and unsafe generations',()=>{for(const fields of [{generation:-1},{seq:Number.MAX_SAFE_INTEGER+1},{connection:'success'},{busy:'false'},{state:{}},{models:null},{projection:{}},{recoveredQueue:[false]}])assert.throws(()=>parseSnapshot({...snapshot(),...fields}));});
test('Given own session summaries When parsing Then paths names and unreadable counts remain explicit',()=>{const value={sessions:[{id:'same-id',path:'X:/one.jsonl',name:null,cwd:'X:/work',updatedAt:'2026-10-03T00:00:00Z',messageCount:2},{id:'same-id',path:'X:/two.jsonl',name:'另一分支',cwd:'X:/work',updatedAt:'2026-10-03T00:00:00Z',messageCount:3}],unreadable:1};assert.deepEqual(parseSessions(value),value);assert.throws(()=>parseSessions({...value,unreadable:-1}));});
test('Given unknown command error When displaying Then never stringify arbitrary diagnostics',()=>{assert.equal(piError({headers:{Authorization:'fixture-secret'}}),'Pi 操作未完成，请核对连接；输入与附件仍保留。');assert.equal(piError({code:'known',message:'固定错误'}),'固定错误');});
