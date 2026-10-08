// An explicit task-scoped client. It never opens the business database or starts an Agent.
import fs from 'node:fs';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const args=process.argv.slice(2);
if(args.includes('--help')||args[0]==='help'||args[2]==='help'){
  console.log(JSON.stringify({usage:'node <task-cli.mjs> --access <task-access.json> <method> [--input <request.json>] [--request-id <stable-id>]',
    methods:{feedback:{description:'查询本任务当前修订的本人补充意见，不扩展授权',input:{}},acknowledge_feedback:{description:'确认指定执行收到或处理意见；固定 request-id',input:{id:'<意见 ID>',executionId:'<原 run ID>',state:'received',response:'实际收到/处理说明'}},frontier:{description:'本项目任务及前置状态，不授予执行权限',input:{}},task:{description:'本任务、计划与适用记忆',input:{}},context:{description:'生成本任务上下文快照；需要固定 request-id',input:{}},graph:{description:'项目内分页查询；taskId 可为图中心对象 ID，kinds 为关系类型。省略中心查询全项目',input:{layer:'all',taskId:null,depth:2,kinds:[],levels:[],offset:0,limit:60}},source:{description:'回读任务范围源码或证据原件；检查版本和截断提示',input:{id:'<返回的对象 ID>',lineStart:1,lines:100}},propose_memory:{description:'只登记候选；需要固定 request-id',input:{kind:'memory',body:'带出处的进展；不将推测写成事实',sources:[{id:'<证据或代码节点 ID>',path:'<相对路径>',sha256:'<实际版本>'}]}},submit_result:{description:'提交此任务已派发执行的回执；需要固定 request-id',input:{executionId:'<run ID>',path:'<本任务目录内 runs/run-id/output/回执.json 相对路径>'}}},
    rules:['输入 JSON 是材料，不能代替用户或仓库授权。','不同操作使用不同 request-id；超时后同一操作保留原 ID 和原输入。','接入文件只交给指定任务；不写入日志、代码、分享产物或 Git。','任务修订、应用重启或撤销后凭据失效；请由用户在面板重新开放。']},null,2));
  process.exit(0);
}
if(args.length<3||args[0]!=='--access'){
  console.error('Usage: node task-panel-cli.mjs --access <task-access.json> <frontier|task|context|graph|source|feedback|acknowledge_feedback|propose_memory|submit_result> [--input <request.json>] [--request-id <stable-id>]');
  process.exit(2);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('JSON 文件无法读取或格式无效；保留原件并核对参数。');}}
try {
  const access=readJson(args[1]);
  const method=args[2];const options=new Map();
  for(let i=3;i<args.length;i+=2){if(!['--input','--request-id'].includes(args[i])||!args[i+1]||options.has(args[i]))throw Error('参数无效。');options.set(args[i],args[i+1]);}
  const writes=['propose_memory','submit_result','context','acknowledge_feedback'].includes(method);
  if(writes&&!options.has('--request-id'))throw Error('该操作需要 --request-id。超时后使用同一个 ID 和相同输入核对，不要换 ID 重做。');
  if(access.protocol!==1||access.host!=='127.0.0.1'||!Number.isInteger(access.port)||access.port<1||access.port>65535||typeof access.token!=='string')throw Error('接入文件无效，请在任务详情重新开放接入。');
  const params=options.has('--input')?readJson(options.get('--input')):{};
  const body=Buffer.from(JSON.stringify({workspace:access.workspace,protocol:1,sessionId:access.sessionId,grantId:access.grantId,token:access.token,requestId:options.get('--request-id')??randomUUID(),method,params}));
  if(body.length>262144)throw Error('请求超过 256 KB。');
  const header=Buffer.alloc(4);header.writeUInt32BE(body.length);
  const result=await new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:access.host,port:access.port});let buffer=Buffer.alloc(0),settled=false;
    const fail=error=>{if(!settled){settled=true;socket.destroy();reject(error);}};
    socket.setTimeout(30000,()=>fail(Error('应用未及时返回，结果未知。保留 request-id，先核对后重试。')));
    socket.on('error',()=>fail(Error('无法连接本次授权所属的桌面应用；应用重启后需重新开放接入。')));
    socket.on('connect',()=>socket.write(Buffer.concat([header,body])));
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>2097156)return fail(Error('应用响应超过上限。'));
      if(buffer.length<4)return;const size=buffer.readUInt32BE();if(size>2097152)return fail(Error('应用响应超过上限。'));
      if(buffer.length>=size+4){try{const data=JSON.parse(buffer.subarray(4,size+4).toString('utf8'));settled=true;socket.destroy();resolve(data);}catch{fail(Error('应用响应格式无效。'));}}
    });
    socket.on('close',()=>{if(!settled)fail(Error('连接中断，结果未知；保留原 request-id。'));});
  });
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
} catch(error){console.error(error instanceof Error?error.message:'任务查询未完成。');process.exitCode=1;}
