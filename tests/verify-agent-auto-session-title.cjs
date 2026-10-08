// Real unmodified Pi RPC and the installed extension source. Model replies are
// an explicit localhost fixture, with fresh synthetic state and no paid calls.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const assert=require('node:assert/strict');
const {validationRun}=require('./support/validation-run.cjs');
const {out,hashes}=validationRun('agent-auto-title-rpc',['app/resources/agent-extensions/auto-session-title.ts','tests/verify-agent-auto-session-title.cjs']);
const report={mode:'real upstream Pi RPC and original AZCine auto-session-title extension; localhost model fixture only',before:hashes(),checks:[],events:[],modelRequests:[]};
const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});assert.ok(ok,name);console.log('PASS',name);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const deadline=Date.now()+15_000;while(!predicate()){if(Date.now()>deadline)throw Error('Title RPC fixture deadline exceeded');await pause(25);}}
(async()=>{
  let server,child,lines;const pending=new Map();let requestId=0;
  try{
    server=http.createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
      const body=JSON.parse(raw),title=body.messages.some(message=>typeof message.content==='string'&&message.content.includes('Give this coding assistant session a specific, short title'));
      report.modelRequests.push({kind:title?'title':'reply',model:body.model});
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const frame=(delta,reason=null)=>`data: ${JSON.stringify({id:'explicit-title-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:reason}]})}\n\n`;
      res.write(frame({role:'assistant'}));
      setTimeout(()=>{if(res.destroyed)return;res.write(frame({content:title?'镜头交付整理':'明确本地回放：已整理。'}));res.write(frame({},'stop'));res.end('data: [DONE]\n\n');},title?250:40);
    });});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const runtime=path.resolve('app/resources/runtime/pi-0.99.1-node-24.21.0');
    const node=path.join(runtime,'node-v24.21.0-win-x64/node.exe'),pkg=path.join(runtime,'pi/node_modules/@earendil-works/pi-coding-agent');
    const data=path.join(out,'data');
    for(const directory of ['agent','sessions','home','appdata','localappdata','temp','workspace'])fs.mkdirSync(path.join(data,directory),{recursive:true});
    fs.writeFileSync(path.join(data,'agent/models.json'),JSON.stringify({providers:{'explicit-title-fixture':{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'explicit-fixture-only',models:[{id:'title-fixture-model',name:'Local title test',reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    fs.writeFileSync(path.join(data,'agent/settings.json'),JSON.stringify({defaultProvider:'explicit-title-fixture',defaultModel:'title-fixture-model'}));
    const system=process.env.SystemRoot||'C:\\Windows';
    const env={SystemRoot:system,WINDIR:system,ComSpec:path.join(system,'System32/cmd.exe'),PATH:[path.dirname(node),path.join(system,'System32'),system].join(path.delimiter),HOME:path.join(data,'home'),USERPROFILE:path.join(data,'home'),APPDATA:path.join(data,'appdata'),LOCALAPPDATA:path.join(data,'localappdata'),TEMP:path.join(data,'temp'),TMP:path.join(data,'temp'),PI_CODING_AGENT_DIR:path.join(data,'agent'),PI_CODING_AGENT_SESSION_DIR:path.join(data,'sessions'),PI_PACKAGE_DIR:pkg,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0'};
    child=spawn(node,['--no-global-search-paths',path.join(pkg,'dist/bundle/cli.js'),'--mode','rpc','--offline','--no-approve','--no-context-files','--session-dir',path.join(data,'sessions'),'--extension',path.resolve('app/resources/agent-extensions/auto-session-title.ts')],{cwd:path.join(data,'workspace'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    report.pid=child.pid;let stderrBytes=0;child.stderr.on('data',chunk=>stderrBytes+=chunk.length);
    lines=createInterface({input:child.stdout});lines.on('line',line=>{
      const value=JSON.parse(line);
      if(value.type==='response'){const done=pending.get(value.id);if(done){pending.delete(value.id);done(value);}}
      else report.events.push(value);
    });
    const request=command=>new Promise((resolve,reject)=>{
      const id=`title-test-${++requestId}`,timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC request timed out'));},12_000);
      pending.set(id,response=>{clearTimeout(timer);response.success?resolve(response.data):reject(Error('RPC rejected title fixture command'));});
      child.stdin.write(JSON.stringify({id,...command})+'\n');
    });
    const initial=await request({type:'get_state'});check('原版连接使用独立虚构模型，初始名称为空',initial.model?.id==='title-fixture-model'&&!initial.sessionName);
    await request({type:'prompt',message:'明确本地测试：整理今天的镜头交付安排。'});
    await until(()=>report.events.some(event=>event.type==='session_info_changed'&&event.name==='镜头交付整理'));
    const eventIndex=report.events.findIndex(event=>event.type==='session_info_changed');
    const settledIndex=report.events.findIndex(event=>event.type==='agent_settled');
    check('扩展在本轮结束后原地发出 session_info_changed，无需切换会话',settledIndex>=0&&eventIndex>settledIndex,{settledIndex,eventIndex});
    const named=await request({type:'get_state'});
    check('命名事件和原生状态名称一致，会话身份保持',named.sessionName==='镜头交付整理'&&named.sessionId===initial.sessionId);
    check('仅本地模拟模型接到聊天和命名两次请求',report.modelRequests.length===2&&report.modelRequests[0].kind==='reply'&&report.modelRequests[1].kind==='title');
    report.stderrBytes=stderrBytes;report.after=hashes();check('原扩展源码未修改',JSON.stringify(report.before)===JSON.stringify(report.after));
  }catch(error){report.failure=String(error);console.error(error);process.exitCode=1;}
  finally{
    if(child){child.stdin.end();const stopped=await Promise.race([new Promise(resolve=>child.once('exit',()=>resolve(true))),pause(3000).then(()=>false)]);if(!stopped)child.kill();}
    lines?.close();if(server)await new Promise(resolve=>server.close(resolve));
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));
  }
})();
