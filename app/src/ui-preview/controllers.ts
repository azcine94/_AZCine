import { useState } from 'react';
import { useWorkspace } from '../use-workspace.ts';
import { useProjects } from '../use-projects.ts';
import { useNews } from '../use-news.ts';
import { useNewsEditorial } from '../use-news-editorial.ts';
import { useNewsProcessing } from '../use-news-processing.ts';
import { useIdeas } from '../use-ideas.ts';
import { usePi } from '../use-pi.ts';
import { usePiProviders } from '../use-pi-providers.ts';
import { useModelRanking } from '../use-model-ranking.ts';
import { useDesktopCheck } from '../use-desktop-check.ts';
import { ideaDraft } from '../ideas-contract.ts';
import { processingPhases } from '../news-processing-client.ts';
import type { ProcessingProgress } from '../news-processing-client.ts';
import type { EditorialRun } from '../news-editorial-contract.ts';
import type { RunStatus } from '../news-contract.ts';
import { statusLabels } from '../news-contract.ts';
import type { ProviderDraft } from '../use-pi-providers.ts';
import * as data from './data.ts';
import { usePreviewResources } from './pi-resources-fixture.ts';

function useFixture<T extends object>(baseline: T, initial: Partial<T>) {
  const [patch, setPatch] = useState(initial);
  return [ {...baseline, ...patch}, (value: Partial<T> | ((before: T) => Partial<T>)) => setPatch(before => ({...before, ...(typeof value === 'function' ? value({...baseline,...before}) : value)})) ] as const;
}
const message = 'UI 示例：操作只在本页展示，不抓取、不调用模型、不写入业务数据。';
const failure = '示例失败：连接暂时不可用，已保留输入和现有内容。';
export function usePreviewControllers(state: string) {
  const empty = state === 'empty', error = state === 'error', loading = state === 'loading';
  const long = state === 'long', pending = state === 'pending', conflict = state === 'conflict' || state === 'conflict-details';
  const dirty = state === 'dirty' || conflict || state === 'discard-confirm';
  const sampleProject = structuredClone(data.project);
  const projectDraft = structuredClone(sampleProject);
  if(conflict) {sampleProject.revision=2;sampleProject.name+=' · 正式记录已更新';projectDraft.name+=' · 保留的手改草稿';}
  if(state==='stage-error')projectDraft.labels.push({id:data.uuid(72),name:'示例重复标签'});
  const projectUndo = {kind:'block' as const,projectId:sampleProject.id,block:projectDraft.blocks[0],position:{beforeId:null,afterId:projectDraft.blocks[1].id}};
  if(state==='project-undo')projectDraft.blocks.shift();
  if (long) { sampleProject.name += ' · 用于检查非常长的项目名称与多行内容显示'.repeat(3); sampleProject.blocks[0].title += ' · 长标题'.repeat(5); }
  const sampleIdea = {...data.idea, body: long ? data.idea.body.repeat(30) : data.idea.body,deleted:state==='removed',todoId:state==='converted'?data.uuid(50):null};
  const ideaEditing = state==='editing' || conflict;
  const sampleIdeaDraft = ideaDraft(sampleIdea);
  if(conflict){sampleIdea.revision=2;sampleIdeaDraft.body+='\n这里保留尚未保存的手动编辑。';}
  const sampleEvent = structuredClone(data.event);
  if (long) { sampleEvent.draft.title += '：检查多行标题、中文导读和保留原始出处的布局'.repeat(3); sampleEvent.draft.summary = sampleEvent.draft.summary.repeat(15); }
  if (state === 'review') sampleEvent.draft.needsReview = true;
  if (state === 'hot') {const item={...data.materials[1],sourceId:'rss-ui-secondary',sourceName:'第二个独立示例信源'};sampleEvent.materials.push(item);sampleEvent.draft.materialIds.push(item.id);}
  const allMaterials = data.materials.map(item => long ? {...item, title: item.title.repeat(8), summary: item.summary?.repeat(25) ?? ''} : item);
  const fixtureSource = structuredClone(data.source);
  if (Object.hasOwn(statusLabels,state)) { fixtureSource.lastStatus = state as RunStatus; fixtureSource.lastError = /Failed|interrupted/.test(state) ? failure : null; }
  if (state === 'paused') fixtureSource.config.enabled = false;
  const fixtureConfig = {...data.config, collectionProxy: state === 'proxy' ? 'http://127.0.0.1:7890' : null, model: state === 'awaitingModel' ? null : data.config.model};
  const isPhase = Object.hasOwn(processingPhases,state);
  const runStatus: EditorialRun['status'] = state==='retry-confirm'?'failed':['failed','awaitingModel','interrupted','cancelled','saving'].includes(state) ? state as EditorialRun['status'] : isPhase && state !== 'completed' ? 'running' : 'completed';
  const sampleRun = {...data.run, status: runStatus, error: ['failed','interrupted','awaitingModel'].includes(state) ? failure : null, finishedAt: runStatus==='running' ? null : data.at, processed: runStatus==='completed' ? 1 : 0};
  const [workspace, patchWorkspace] = useFixture(useWorkspace(), {
    connected: true, workspace: {root: state==='no-root' ? null : data.root, defaultRoot: data.root, todos: empty ? [] : [{id: data.uuid(50), title: long ? '核对非常长的分镜描述和交付信息'.repeat(15) : '核对分镜与素材（示例）', dueDate: '2026-10-06', projectId: data.project.id, completed: state==='completed', revision: 1, createdAt: data.at}]}, loading, loadError: state==='root-error' ? failure : '',error:error?failure:'',
    rootDraft: data.root, pendingCreate: pending ? {id:data.uuid(50),title:'示例待核对输入',dueDate:null,projectId:null} : null,
    filter:state==='completed'?'completed':'incomplete',undo:state==='undo'?{todo:{id:data.uuid(50),title:'示例待办',dueDate:null,projectId:null,completed:true,revision:1,createdAt:data.at},completed:false}:null,
  });
  const [projects, patchProjects] = useFixture(useProjects(null), {
    projects: empty ? [] : [sampleProject], drafts: {[sampleProject.id]: {content: long ? sampleProject : projectDraft, baseline: 1, dirty}}, loading, loadError: error ? failure : '',
    newName:state==='create-pending'?'新项目名称已保留（示例）':'',newId:state==='create-pending'?data.uuid(71):null,
    busy:state==='project-saving'?sampleProject.id:'',undos:state==='project-undo'?{[sampleProject.id]:projectUndo}:{},
    labelDrafts:state==='stage-error'?{[sampleProject.id]:'示例重复标签'}:{},
    errors: state==='stage-error'?{[sampleProject.id]:'示例：标签名称重复，输入已保留。'}:error ? {[sampleProject.id]:failure} : {},
    pending: pending ? {[sampleProject.id]: {request: {requestId:data.uuid(51),expectedRevision:1,document:sampleProject}, consumesUndo:false}} : {},
  });
  const [news, patchNews] = useFixture(useNews(null), {
    connected: true, snapshot: {sources: empty ? [] : [fixtureSource], runs: empty ? [] : [{id:data.uuid(52),sourceId:fixtureSource.config.id,sourceName:fixtureSource.config.name,sourceRevision:1,startedAt:data.at,attemptedAt:data.at,finishedAt:data.at,status:fixtureSource.lastStatus ?? 'added',fetched:6,added:6,skipped:0,error:fixtureSource.lastError,warning:null,retryStage:fixtureSource.lastError ? 'fetch' : null}]},
    materials: {items:empty ? [] : allMaterials,total:empty ? 0 : 6,page:0,pageSize:50}, drafts: {[fixtureSource.config.id]:{config:fixtureSource.config,baseline:1,dirty}, new:{config:{...fixtureSource.config,id:data.uuid(53),name:'',feedUrl:''},baseline:null,dirty:false}}, loading, materialsLoading: loading, loadError: error ? failure : '',
    newId:'new', collecting:state==='fetching', pending:pending ? {[fixtureSource.config.id]:{requestId:data.uuid(54),expectedRevision:1,source:fixtureSource.config}} : {},
    previews:state==='preview' ? {[fixtureSource.config.id]:{config:fixtureSource.config,result:{kind:'rss',fetchedAt:data.at,total:6,skipped:0,warning:null,entries:allMaterials.map(item=>({...item,externalId:null}))}}} : {},
  });
  const [editorial, patchEditorial] = useFixture(useNewsEditorial(null), {
    connected:true, snapshot:{preferences:{config:fixtureConfig,revision:1},events:empty ? [] : [sampleEvent],editions:empty ? [] : [{...data.edition,events:[sampleEvent],incomplete:state==='incomplete',gaps:state==='incomplete'?['示例信源不可用，覆盖不完整。']:[]}],runs:empty?[]:[sampleRun],pending:empty?0:6,nextDailyAt:null},
    draft:empty?null:{config:dirty ? {...fixtureConfig,featuredScore:90} : fixtureConfig,revision:1},pending:pending?{requestId:data.uuid(55),expectedRevision:1,config:fixtureConfig}:null,
    loading,loadError:error?failure:'', active:sampleRun.status==='running'||sampleRun.status==='saving', busy:'',
    tab:state==='daily'||state==='incomplete'?'daily':state==='all'?'all':state==='hot'?'hot':'featured',domain:state==='filtered'?'frontiers':'',
    copyEditionId:data.edition.id, copyText:'示例日报完整内容\n\n'+data.event.draft.summary,
  });
  const progress: ProcessingProgress = {runId:sampleRun.id, phase:isPhase?state:'completed',startedAt:new Date(Date.now()-13000).toISOString(),updatedAt:new Date().toISOString(),batch:1,batches:1,batchSize:1,completed:sampleRun.processed,total:1,pid:null,model:fixtureConfig.model,input:[allMaterials[0]],response:state==='waitingModel'||state==='connecting'?'':JSON.stringify({events:[sampleEvent.draft]},null,2),receivedChars:state==='waitingModel'?0:800,steps:[{at:data.at,phase:'preparing'},{at:data.at,phase:'sending'},{at:data.at,phase:isPhase?state:'completed'}],error:sampleRun.error};
  const [processing, patchProcessing] = useFixture(useNewsProcessing(null,false,false), {
    pending:{items:empty?[]:allMaterials,total:empty?0:6,page:0,pageSize:6},selected:empty?null:allMaterials[0],dailyCount:{total:empty?0:6,at:data.at},progress:state==='normal'||empty?null:progress,loading,error:error?failure:'',
    detail:state==='detail'?{runId:sampleRun.id,batch:1,batches:1,batchSize:1,configRevision:1,rules:fixtureConfig,input:[allMaterials[0]],outputs:[{name:'模型返回',text:progress.response,truncated:false}],result:sampleEvent.draft,progress}:null,
    detailTarget:state==='detail'?{id:sampleRun.id,batch:1}:null,scope:state==='all-scope'?'all':'single',
  });
  const [ideas, patchIdeas] = useFixture(useIdeas(null), {ideas:empty?[]:[sampleIdea],drafts:{new:ideaDraft({...sampleIdea,title:'',body:'',tags:[],projectId:null}),[sampleIdea.id]:sampleIdeaDraft},editing:ideaEditing?{[sampleIdea.id]:true}:{},loading,loadError:error?failure:'',pending:pending?{[sampleIdea.id]:{requestId:data.uuid(56),expectedRevision:1,content:sampleIdea}}:{},deleted:state==='removed',undo:state==='undo'?sampleIdea:null});
  const samplePi = structuredClone(data.piSnapshot);
  if(state==='agent-models'||state==='provider-multiple'){samplePi.models=Array.from({length:5},(_,index)=>({...data.piSnapshot.models[0],id:`example-model-${index+1}`,name:`示例模型 ${index+1} · ${index%2?'图像与文本':'推理'}`}));samplePi.state={...samplePi.state!,model:samplePi.models[0]};}
  samplePi.projection.messages=empty?[]:[
    {role:'user',content:[{type:'text',text:'帮我核对分镜与镜头清单，把需要我确认的差异列出来。'}]},
    {role:'assistant',content:[{type:'thinking',thinking:'先核对说明与镜头内容，再检查交付信息。'},{type:'toolCall',id:'ui-read',name:'read',arguments:{path:'ui-example.md'}}],stopReason:'toolUse'},
    {role:'toolResult',toolCallId:'ui-read',toolName:'read',isError:error,content:[{type:'text',text:error?failure:'示例资料中有两项交付信息尚未确认。'}]},
    {role:'assistant',content:[{type:'text',text:long?'这是一段用来检查长回复排版的示例内容。'.repeat(100):'有两项需要你确认：\n\n1. 最终交付日期。\n2. 短版是否需要竖屏输出。\n\n以上是虚构资料中的示例，不更新项目记录。'}],stopReason:error?'error':state==='interrupted'?'aborted':'stop',...(error?{errorMessage:failure}:{})},
  ];
  samplePi.projection.outcome=state==='interrupted'?'interrupted':error?'error':'success';
  if (state==='running'||state==='compacting') {samplePi.projection.messages.pop();samplePi.projection.partial={role:'assistant',content:[{type:'thinking',thinking:'正在核对示例资料中的镜头信息。'}],stopReason:'pending'};samplePi.projection.activity=state==='running'?'running':'compacting';samplePi.state={...samplePi.state!,isStreaming:state==='running',isCompacting:state==='compacting'};}
  if (state==='queued') {samplePi.projection.steering=['优先核对交付规格（示例）'];samplePi.projection.followUp=['再整理需要确认的镜头（示例）'];samplePi.state={...samplePi.state!,pendingMessageCount:2};}
  if (long) samplePi.paths={agent:'UI fixture / '+ '非常长的资源目录/'.repeat(15),sessions:'UI fixture / 示例会话目录',defaultCwd:data.root};
  const [pi, patchPi] = useFixture(usePi(null), {connected:true,root:data.root,snapshot:state==='disconnected'?null:{...samplePi,connection:state==='connecting'?'connecting':error?'error':'ready',error:error?{code:'ui-fixture',message:failure}:null},error:error?failure:null,
    sessions:empty?[]:Array.from({length:state==='agent-sessions'?8:1},(_,index)=>({id:data.uuid(42+index),path:`UI fixture / session-${index}`,name:long?'用于检查很长会话名称的示例标题'.repeat(10):`分镜与交付核对 ${index+1}（示例）`,cwd:data.root,updatedAt:data.at,messageCount:4+index})),displayRunStart:0,sessionName:'示例会话名称',
    ...(state==='attachments'?{draft:{text:'这是带附件的示例消息',images:[{id:data.uuid(60),name:'ui-example.png',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZmcAAAAASUVORK5CYII='}]}}:{}),
  });
  const providerItems:ProviderDraft[]=Array.from({length:state==='provider-multiple'?4:1},(_,index):ProviderDraft=>({...structuredClone(data.provider),uid:data.uuid(80+index),provider:`ui-example-${index+1}`,dirty,tab:state==='models'||state==='provider-interface'||state==='provider-multiple'?'models':state==='advanced'?'advanced':'connection',fetching:state==='provider-fetching',models:state==='provider-multiple'?Array.from({length:4},(_,modelIndex)=>({...data.provider.models[0],uid:data.uuid(100+index*10+modelIndex),id:`example-${index}-${modelIndex}`,name:`示例模型 ${modelIndex+1}`})):data.provider.models,remote:state==='remote'?{models:[{id:'example-new-model',name:'远程示例模型',contextWindow:64000,maxTokens:4096,supportsImages:true}],truncated:false}:null,error:error?failure:null}));
  const [providers, patchProviders] = useFixture(usePiProviders(null,false,pi), {ready:true,providers:empty?[]:providerItems,active:undefined,saving:state==='provider-saving'?providerItems[0].uid:null,loading,loadError:error?failure:null});
  const [rankings] = useFixture(useModelRanking(null,false), {connected:true,boards:{agent:empty?{...data.board('agent'),snapshot:null}:data.board('agent'),'text-to-image':empty?{...data.board('text-to-image'),snapshot:null}:data.board('text-to-image')},loading,loadError:error?failure:'',busy:state==='busy'?{board:'agent',action:'正在刷新示例榜单'}:null});
  const [desktop, patchDesktop] = useFixture(useDesktopCheck(), {connected:true,state:loading?{status:'loading'}:error?{status:'error',message:failure}:state==='success'?{status:'success',report:{requestId:1,sqliteVersion:'示例',appVersion:'示例',storage:"temporary",roundTrip:true,rollback:true}}:{status:'idle'}});
  const [notice, setNotice] = useState('');
  const announce = () => {setNotice(message);};
  const action = async () => {announce();};
  function changeProvider(uid:string,update:(item:ProviderDraft)=>ProviderDraft) {patchProviders(before=>({providers:before.providers.map(item=>item.uid===uid?update(item):item)}));}
  const active = providers.providers.find(item=>item.uid===providers.active?.uid) ?? providers.providers[0];
  const resourcePreview = usePreviewResources(pi.resources, state);
  return {
    notice, clearNotice:()=>setNotice(''),
    workspace:{...workspace,setFilter:(value)=>patchWorkspace(before=>({filter:typeof value==='function'?value(before.filter):value})),changeRoot:(value:string)=>patchWorkspace({rootDraft:value}),changeDraft:(field,value)=>patchWorkspace(before=>({draft:{...before.draft,[field]:value}})),refresh:action,pickRoot:action,selectRoot:action,openRoot:action,saveTodo:action,reconcileCreate:action,changeCompletion:async(todo,completed)=>patchWorkspace(before=>({workspace:before.workspace?{...before.workspace,todos:before.workspace.todos.map(item=>item.id===todo.id?{...item,completed}:item)}:null}))},
    projects:{...projects,refresh:action,changeQuery:value=>patchProjects(before=>({query:typeof value==='function'?value(before.query):value})),changeNewName:value=>patchProjects({newName:value}),change:(id,update)=>{patchProjects(before=>({drafts:{...before.drafts,[id]:{...before.drafts[id],content:update(before.drafts[id].content),dirty:true}}}));return true;},save:action,create:async()=>{announce();return null;},reconcile:action,rebase:announce,replaceWithOfficial:announce,changeLabelDraft:(id,value,labelId)=>patchProjects(before=>({labelDrafts:{...before.labelDrafts,[labelId?`${id}/${labelId}`:id]:value}})),putUndo:(id,value)=>patchProjects(before=>({undos:value?{...before.undos,[id]:value}:Object.fromEntries(Object.entries(before.undos).filter(([key])=>key!==id))}))},
    news:{...news,refresh:action,readMaterials:action,collect:action,cancelCapture:action,saveSource:action,reconcile:action,preview:async(id)=>patchNews(before=>({previews:{...before.previews,[id]:{config:before.drafts[id].config,result:{kind:'rss',fetchedAt:data.at,total:6,skipped:0,warning:null,entries:allMaterials.map(item=>({...item,externalId:null}))}}}})),changeFilter:(value)=>patchNews({filter:value}),changeDraft:(id,update)=>patchNews(before=>({drafts:{...before.drafts,[id]:{...before.drafts[id],config:{...before.drafts[id].config,...update},dirty:true}}})),startNew:()=>"new",toggle:async(item)=>patchNews(before=>({snapshot:{...before.snapshot,sources:before.snapshot.sources.map(s=>s.config.id===item.config.id?{...s,config:{...s.config,enabled:!s.config.enabled}}:s)}})),useLatest:announce,openOriginal:action},
    editorial:{...editorial,refresh:action,save:action,reconcile:action,setTab:(value)=>patchEditorial(before=>({tab:typeof value==='function'?value(before.tab):value})),setDomain:(value)=>patchEditorial(before=>({domain:typeof value==='function'?value(before.domain):value})),changeConfig:(value)=>patchEditorial(before=>({draft:before.draft?{...before.draft,config:value}:null})),rebase:announce,organize:action,cancel:action,analyze:action,copy:action,exportPdf:action,readEditionText:async()=>`AZCine 示例日报 · 2026-10-04\n\n${sampleEvent.draft.title}\n\n${sampleEvent.draft.summary}\n\n来源：${data.materials[0].url}\n\n全部为 UI 虚构资料，不代表真实资讯。`},
    processing:{...processing,setScope:value=>patchProcessing(before=>({scope:typeof value==='function'?value(before.scope):value})),setBatchSize:value=>patchProcessing(before=>({batchSize:typeof value==='function'?value(before.batchSize):value})),setQuery:value=>patchProcessing(before=>({query:typeof value==='function'?value(before.query):value})),setSource:value=>patchProcessing(before=>({source:typeof value==='function'?value(before.source):value})),setEventQuery:value=>patchProcessing(before=>({eventQuery:typeof value==='function'?value(before.eventQuery):value})),select:(value)=>patchProcessing({selected:typeof value==='function'?value(processing.selected):value}),refresh:action,readProgress:action,inspect:async(id,batch=1)=>patchProcessing({detailTarget:{id,batch},detail:{runId:id,batch,batches:1,batchSize:1,configRevision:1,rules:fixtureConfig,input:[allMaterials[0]],outputs:[{name:'模型返回',text:progress.response,truncated:false}],result:sampleEvent.draft,progress}})},
    ideas:{...ideas,refresh:action,save:action,reconcile:action,remove:action,convert:action,continueOnCurrent:action,setDeleted:(value)=>patchIdeas(before=>({deleted:typeof value==='function'?value(before.deleted):value})),changeDraft:(key,field,value)=>patchIdeas(before=>({drafts:{...before.drafts,[key]:{...before.drafts[key],[field]:value}}})),edit:(item)=>patchIdeas(before=>({editing:{...before.editing,[item.id]:true}})),closeEdit:(id)=>patchIdeas(before=>({editing:{...before.editing,[id]:false}}))},
    pi:{...pi,resources:resourcePreview,setSessionName:value=>patchPi(before=>({sessionName:typeof value==='function'?value(before.sessionName):value})),setText:(text)=>patchPi(before=>({draft:{...before.draft,text}})),setImages:(images)=>patchPi(before=>({draft:{...before.draft,images}})),refresh:action,reloadSessions:action,connect:action,disconnect:action,send:action,stop:action,sessionAction:action,saveModel:async()=>{announce();return false;},saveConfiguration:async()=>{announce();return null;}},
    providers:{...providers,active,reload:action,select:(uid)=>patchProviders({active:providers.providers.find(item=>item.uid===uid)}),addProvider:()=>{const item={...data.provider,uid:crypto.randomUUID(),provider:`provider-${providers.providers.length+1}`,persisted:false,dirty:true,models:[]};patchProviders(before=>({providers:[...before.providers,item],active:item}));},ui:(uid,patch)=>changeProvider(uid,item=>({...item,...patch})),edit:(uid,patch)=>changeProvider(uid,item=>({...item,...patch,dirty:true})),editModel:(uid,modelUid,patch)=>changeProvider(uid,item=>({...item,dirty:true,models:item.models.map(m=>m.uid===modelUid?{...m,...patch}:m)})),addManual:(uid)=>changeProvider(uid,item=>({...item,models:[...item.models,{...data.provider.models[0],uid:crypto.randomUUID(),id:'',name:'',persisted:false}],tab:'models',dirty:true})),removeNew:(uid,modelUid)=>changeProvider(uid,item=>({...item,models:item.models.filter(m=>m.uid!==modelUid)})),addSelected:(uid)=>changeProvider(uid,item=>({...item,models:[...item.models,...(item.remote?.models.filter(m=>item.selectedIds.includes(m.id)).map(m=>({...data.provider.models[0],uid:crypto.randomUUID(),id:m.id,name:m.name,persisted:false}))??[])],dirty:true,selectedIds:[]})),fetchModels:async(uid)=>changeProvider(uid,item=>({...item,remote:{models:[{id:'example-new-model',name:'远程示例模型',contextWindow:64000,maxTokens:4096,supportsImages:true}],truncated:false}})),save:action},
    rankings:{...rankings,refresh:action,update:action,cancel:announce,openSource:action},desktop:{...desktop,check:async()=>patchDesktop({state:{status:'error',message:'UI 总览不执行数据库检查；成功样式请切换到成功状态。'}})},
  } satisfies {notice:string;clearNotice:()=>void;workspace:typeof workspace;projects:typeof projects;news:typeof news;editorial:typeof editorial;processing:typeof processing;ideas:typeof ideas;pi:typeof pi;providers:typeof providers;rankings:typeof rankings;desktop:typeof desktop};
}
