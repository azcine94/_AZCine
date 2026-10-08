// Explicit local replay for upstream Pi integration tests. No provider network.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]);if(!out.startsWith(path.resolve('artifacts/validation')+path.sep))throw Error('Fixture output must be retained under validation.');
fs.mkdirSync(out,{recursive:true});let count=0,active=0,maxActive=0;
const server=http.createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({count,active,maxActive}));}
 if(req.method==='GET'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'agent-explicit-fixture',object:'model'}]}));}
 let text='';req.on('data',chunk=>{text+=chunk;if(text.length>2*1024*1024)req.destroy();});req.on('end',()=>{
  let body;try{body=JSON.parse(text);}catch{return res.writeHead(400).end();}
  const message=body.messages?.findLast(m=>m.role==='user')?.content??'';const plain=typeof message==='string'?message:JSON.stringify(message);count++;active++;maxActive=Math.max(maxActive,active);
  const duration=/SLOW_FIXTURE/.test(plain)?3500:120;
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'explicit-replay',object:'chat.completion.chunk',created:1,model:'agent-explicit-fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  send({role:'assistant',content:'明确本地回放：'});
  let ended=false;const done=()=>{if(!ended){ended=true;active--;}};res.once('close',done);
  setTimeout(()=>{if(res.destroyed)return;const content=/DRAFT_FIXTURE/.test(plain)?'\n```azcine-draft\n{"version":1,"operations":[{"module":"projects","objectId":"unknown-fixture","action":"rename","values":{"title":"虚构"}}],"decisions":[]}\n```':'整理结果。原版RPC与应用链路实际运行，模型正文为测试fixture。';send({content});send({},'stop');res.write('data: [DONE]\n\n');res.end();done();},duration);
 });
});
server.listen(0,'127.0.0.1',()=>{const port=server.address().port;fs.writeFileSync(path.join(out,'model-fixture.json'),JSON.stringify({port,pid:process.pid,mode:'explicit-local-replay-no-paid-inference'}));console.log(JSON.stringify({port,pid:process.pid}));});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
