import {useOperationNotice} from './components/ui/operation-toast.tsx';
import {useAgentObjects} from './use-agent-objects.ts';
import { Button } from './components/ui/button.tsx';
// Loaded only by the development preview entry. No IPC, storage or model requests.
import { useMemo, useRef, useState } from 'react';
import { AgentChat } from './pi-agent-panel.tsx';
import type { PiController } from './use-pi.ts';
import { usePiResources } from './use-pi-resources.ts';
import type { PiProjection, PiSession, PiSnapshot } from './pi-client.ts';
import type { PiModel } from './pi-contract.ts';

type Scenario='complete'|'running'|'error'|'interrupted';
const ROOT='azcine-visual-demo';
const MODEL:PiModel={id:'visual-example',name:'示例模型',provider:'本地演示',api:'openai-completions',input:['text'],reasoning:true,contextWindow:128000,maxTokens:8192};
const MODELS:PiModel[]=[MODEL,{...MODEL,id:'visual-example-image',name:'示例视觉模型',input:['text','image']},{...MODEL,id:'visual-example-fast',name:'示例快速模型',reasoning:false}];
const sessions:PiSession[]=[
  {id:'delivery',path:'demo/delivery',name:'广告片 · 交付资料核对',cwd:'demo',updatedAt:'今天',messageCount:6},
  {id:'storyboard',path:'demo/storyboard',name:'短片 · 分镜节奏梳理',cwd:'demo',updatedAt:'今天',messageCount:6},
  {id:'technical',path:'demo/technical',name:'镜头 · 灯光方案讨论',cwd:'demo',updatedAt:'昨天',messageCount:6},
];
const thinking=(text:string)=>({type:'thinking',thinking:text,redacted:null});
const call=(id:string,name:string,args:Record<string,unknown>)=>({type:'toolCall',id,name,arguments:args});
const assistant=(content:unknown[],stopReason='stop')=>({role:'assistant',content,stopReason});
const result=(id:string,name:string,text:string,isError=false)=>({role:'toolResult',toolCallId:id,toolName:name,isError,content:[{type:'text',text}]});
function exampleProjection(session:PiSession,scenario:Scenario):PiProjection {
  const topic=session.id==='delivery'?{
    question:'帮我核对 brief 和镜头清单，把需要我确认的差异整理出来。',
    thinking:'先核对项目要求与交付资料，再检查镜头清单中的交期和输出规格。',
    result:'已读取 brief.md 与镜头清单，交付规格为 3840 × 2160 / 25 fps。',
    later:'正在整理需要本人确认的差异，缺失的信息会保留待确认。',
    answer:'资料已核对，有 2 项需要你确认：\n\n1. 交付日期：brief 写的是 10 月 12 日，镜头清单是 10 月 14 日，请确认以哪份为准。\n2. 输出规格：主片规格一致；15 秒短版是否需要竖屏版本，资料中还没有明确。\n\n建议先确认这两项，再更新项目记录。',
  }:session.id==='storyboard'?{
    question:'帮我看看这段 30 秒分镜，哪里可以收紧节奏？',
    thinking:'先看镜头之间的动作关系与情绪变化，再核对每段时长。',
    result:'已读取 storyboard.md：开场、产品展示和收尾三个段落。',
    later:'整理能够保留信息、同时减少重复的镜头衔接。',
    answer:'可以从两个位置收紧节奏：\n\n• 开场的两个全景承担相同信息，保留构图更明确的一个。\n• 产品展示段保留一次完整动作，减少两次重复的细节切换。\n\n收尾先维持原来的停留时间，给品牌信息留出阅读空间。以上是虚构分镜的展示建议。',
  }:{
    question:'这组室内镜头想要清晨感，给我一个简洁的灯光思路。',
    thinking:'围绕窗光方向、室内反射和前景层次整理方案。',
    result:'已读取 lighting-notes.md：主要光源来自画面左侧窗户。',
    later:'将光线方向与材料表现拆成可操作的建议。',
    answer:'可以先用一组主光建立清晨感：\n\n• 窗光方向保持统一，先定墙面和人物的明暗关系。\n• 室内反射稍暖，窗外光稍冷，避免所有补光都一样亮。\n• 前景保留较暗的轮廓，让注意力集中在主体。\n\n先在一个代表镜头里定好比例，再扩到整组。此方案为虚构展示内容。',
  };
  const messages:unknown[]=[{role:'user',content:[{type:'text',text:topic.question}]},assistant([thinking(topic.thinking),call('demo-read','read',{path:session.id==='delivery'?'brief.md':session.id==='storyboard'?'storyboard.md':'lighting-notes.md'})],'toolUse'),result('demo-read','read',topic.result)];
  if(scenario==='running')return{messages,partial:assistant([thinking(topic.later),call('demo-bash','bash',{command:'查看示例镜头清单'})],'pending'),tools:[{id:'demo-bash',name:'bash',status:'running',result:{content:[{type:'text',text:'正在核对清单中的镜头与交付信息…'}]}}],activity:'running',outcome:'none',steering:[],followUp:[],notice:null};
  if(scenario==='error'){messages.push(assistant([thinking(topic.later),call('demo-missing','read',{path:'project-notes.md'})],'toolUse'),result('demo-missing','read','示例错误：资料文件暂时不可读取，原输入已保留。',true),{...assistant([{type:'text',text:'项目笔记尚未读取完整。已经取得的资料保留，缺失部分待确认。'}],'error'),errorMessage:'示例失败状态：未继续执行，不作为完成。'});}
  else if(scenario==='interrupted')messages.push(assistant([thinking('正在整理核对结果。你已停止本次展示中的任务。')],'aborted'));
  else messages.push(assistant([thinking(topic.later),call('demo-check','bash',{command:'核对示例镜头清单'})],'toolUse'),result('demo-check','bash','已核对交付字段：发现两项待确认信息。'),assistant([{type:'text',text:topic.answer}]));
  return{messages,partial:null,tools:[],activity:'idle',outcome:scenario==='error'?'error':scenario==='interrupted'?'interrupted':'success',steering:[],followUp:[],notice:null};
}

export default function AgentDemo({onExit}:{onExit:()=>void}) {
  const resources=usePiResources(null);
  const [active,setActive]=useState(sessions[0]),[scenario,setScenario]=useState<Scenario>('complete');
  const [selectedModel,setSelectedModel]=useState(MODEL);
  const [removedSessions,setRemovedSessions]=useState<string[]>([]);
  const [sessionPins,setSessionPins]=useState<string[]>([]);
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[sessionName,setSessionName]=useState(''),[notice,setNotice]=useOperationNotice<string|null>(null);
  const [choices,setChoices]=useState<Record<string,boolean>>({});
  const [modelForm,setModelForm]=useState<PiController['modelForm']>({provider:'',baseUrl:'',api:'openai-completions',modelId:'',name:'',contextWindow:'128000',maxTokens:'8192',reasoning:false,supportsImages:false,apiKey:''});
  const scroll=useRef<Record<string,{top:number;following:boolean}>>({});
  const projection=useMemo<PiProjection>(()=>active.id==='new-demo'?{messages:[],partial:null,tools:[],activity:'idle',outcome:'none',steering:[],followUp:[],notice:null}:exampleProjection(active,scenario),[active,scenario]);
  const generation={complete:1,running:2,error:3,interrupted:4}[scenario];
  const objects=useAgentObjects(null,active.id);
  const snapshot:PiSnapshot={generation,seq:0,connection:'ready',busy:false,stopping:false,sending:false,state:{sessionId:active.id,sessionFile:active.path,sessionName:active.name,model:selectedModel,thinkingLevel:'medium',isStreaming:scenario==='running',isCompacting:false,pendingMessageCount:0,messageCount:projection.messages.length},models:MODELS,projection,recoveredQueue:[],error:null,notice:null,cwd:'demo',runtime:null,paths:null};
  const switchSession=(session:PiSession)=>{setActive(session);setScenario('complete');setNotice(null);setSessionName('');};
  const controller:PiController={
    sessionPins,setSessionPinned:(sessionId,pinned)=>setSessionPins(before=>pinned?before.includes(sessionId)?before:[...before,sessionId]:before.filter(id=>id!==sessionId)),
    objects,prepareRedo:async()=>{},uiAnswers:{},setUiAnswer:()=>{},conversationKey:'ui-demo',source:{module:'agent',page:'agent',objectId:null},openSource:async()=>{},newConversation:async()=>{},selectConversation:async()=>{},runtimeSummary:null,refreshRuntime:async()=>{},saveLimit:async()=>{},files:[],attachFile:async()=>{},removeFile:()=>{},respondUi:async()=>{},stats:null,refreshStats:async()=>{},takeEditor:()=>{},
    deleteConversation:async target=>{if(target.sessionId===active.id&&scenario==='running')return{deleted:false,error:'请先结束运行，再删除示例会话。'};setRemovedSessions(before=>[...before,target.sessionId]);setSessionPins(before=>before.filter(id=>id!==target.sessionId));if(target.sessionId===active.id)switchSession(sessions.find(session=>session.id!==target.sessionId&&!removedSessions.includes(session.id))??{...sessions[0],id:'new-demo',path:'demo/new',name:'新示例会话',messageCount:0});return{deleted:true};},
    deleteConversations:async targets=>{
      const unique=[...new Map(targets.map(target=>[target.sessionId,target])).values()];
      const protectedRows=unique.filter(target=>target.sessionId===active.id&&scenario==='running');
      const deleted=unique.filter(target=>!protectedRows.includes(target)).map(target=>target.sessionId);
      setRemovedSessions(before=>[...new Set([...before,...deleted])]);setSessionPins(before=>before.filter(id=>!deleted.includes(id)));
      if(deleted.includes(active.id))switchSession(sessions.find(session=>!deleted.includes(session.id)&&!removedSessions.includes(session.id))??{...sessions[0],id:'new-demo',path:'demo/new',name:'新示例会话',messageCount:0});
      return{deleted,errors:protectedRows.map(target=>({sessionId:target.sessionId,error:'请先结束运行，再删除示例会话。'}))};
    },
    resources,
    snapshot,root:ROOT,connected:true,error:null,notice,action:null,cwd:'demo',setCwd:()=>{},sessions:(active.id==='new-demo'?[active,...sessions]:sessions.map(session=>session.id===active.id?{...active,messageCount:projection.messages.length}:session)).filter(session=>!removedSessions.includes(session.id)),unreadable:0,sessionError:null,
    draft:{text:drafts[active.id]??'',images:[]},draftKey:active.id,setText:text=>setDrafts(before=>({...before,[active.id]:text})),setImages:()=>{},
    refresh:async()=>{},reloadSessions:async()=>{setNotice('示例会话已全部载入。');},connect:async session=>{if(session)switchSession(session);},disconnect:async()=>{},
    send:async()=>{setNotice('这是界面示例。切回真实会话后才能发送。');},stop:async()=>{},
    sessionAction:async(command,fields={})=>{
      if(command==='pi_switch_session'){const next=sessions.find(s=>s.path===fields.path);if(next)switchSession(next);}
      else if(command==='pi_new_session'){switchSession({...sessions[0],id:'new-demo',path:'demo/new',name:'新示例会话',messageCount:0});}
      else if(command==='pi_name_session'&&typeof fields.name==='string'){setActive(before=>({...before,name:fields.name as string}));setSessionName('');}
      else if(command==='pi_select_model'){const next=MODELS.find(value=>value.provider===fields.provider&&value.id===fields.id);if(next)setSelectedModel(next);}
    },
    saveModel:async()=>false,saveConfiguration:async()=>null,recoverQueue:()=>{},acceptedInputs:[],recoverAccepted:()=>{},modelForm,setModelForm,sessionName,setSessionName,
    processChoices:choices,chooseProcess:(key,open)=>setChoices(before=>({...before,[key]:open})),
    rememberChatScroll:(key,top,following)=>{scroll.current[key]={top,following};},readChatScroll:key=>scroll.current[key],displayRunStart:0,
  };
  return <div className="pi-preview-workspace">
    <div className="pi-preview-strip"><span className="pi-preview-label">演示数据</span><span className="pi-preview-disclaimer">虚构会话 · 不调用模型，不保存记录</span>
      <div className="pi-preview-scenarios" role="group" aria-label="示例状态">{([['complete','已完成'],['running','执行中'],['error','失败'],['interrupted','已中断']] as const).map(([value,label])=><Button variant="app-control" type="button" key={value} aria-pressed={scenario===value} onClick={()=>{setScenario(value);setNotice(null);}}>{label}</Button>)}</div>
      <Button variant="app-control" type="button" onClick={onExit}>切回真实会话</Button>
    </div>
    <AgentChat model={controller} preview/>
  </div>;
}
