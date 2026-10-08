import { defaultThinkingMap } from '../pi-thinking.ts';
import {useAgentJobs} from '../use-agent-jobs.ts';
import {useAgentData} from '../use-agent-data.ts';
import { notifyOperation, useOperationNotice } from '../components/ui/operation-toast.tsx';
import { isHistoryReset } from '../use-news-reset.ts';
import type { NewsResetMode } from '../use-news-reset.ts';
import { useRef, useState } from 'react';
import { useWorkspace } from '../use-workspace.ts';
import { useProjects } from '../use-projects.ts';
import type { ProjectDocument } from '../projects-contract.ts';
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
import type { EditorialConfig,EditorialRun } from '../news-editorial-contract.ts';
import type { RunStatus } from '../news-contract.ts';
import { statusLabels } from '../news-contract.ts';
import type { ProviderDraft } from '../use-pi-providers.ts';
import * as data from './data.ts';
import { usePreviewResources } from './pi-resources-fixture.ts';
import { usePreviewBookkeeping } from './bookkeeping-fixture.ts';
import { draftApplyFailure,reviewFixture } from './agent-review-fixture.ts';
import { usePreviewTaskPanel } from './task-panel-fixture.ts';
import { usePreviewEnvironment } from './dev-environment-fixture.ts';

function useFixture<T extends object>(baseline: T, initial: Partial<T>) {
  const [patch, setPatch] = useState(initial);
  return [ {...baseline, ...patch}, (value: Partial<T> | ((before: T) => Partial<T>)) => setPatch(before => ({...before, ...(typeof value === 'function' ? value({...baseline,...before}) : value)})) ] as const;
}
const message = 'UI 示例：操作只在本页展示，不抓取、不调用模型、不写入业务数据。';
const failure = '示例失败：连接暂时不可用，已保留输入和现有内容。';
export function usePreviewControllers(requestedState: string) {
  const sidebarState=requestedState.startsWith('agent-sidebar');
  const state=sidebarState?'normal':requestedState;
  const piState=sidebarState?(requestedState==='agent-sidebar'?'normal':requestedState.slice('agent-sidebar-'.length)==='extension'?'agent-extension':requestedState.slice('agent-sidebar-'.length)):state;
  const piLong=piState==='long',piFailed=piState==='error';
  const taskPanelPreview = usePreviewTaskPanel(state);
  const environmentPreview = usePreviewEnvironment(state);
  const bookkeeping = usePreviewBookkeeping(state);
  const empty = state === 'empty', error = state === 'error', loading = state === 'loading';
  const long = state === 'long', pending = state === 'pending', conflict = state === 'conflict' || state === 'conflict-details';
  const dirty = state === 'dirty' || conflict || state === 'discard-confirm';
  const sampleProject = structuredClone(data.project);
  if(state==='table-images'||state==='table-image-preview') {
    const table=sampleProject.blocks.find(block=>block.kind==='list');
    if(table?.kind==='list') table.rows[0].images={[table.columns[0].id]:[{id:data.uuid(210),name:'镜头参考.png',mimeType:'image/png',bytes:640,hash:'0'.repeat(64)}]};
  }
  if (long) { const table = sampleProject.blocks.find(block => block.kind === 'list'); if (table?.kind === 'list') { const textColumn = table.columns.find(column => column.kind === 'text'); if (textColumn) table.rows[0].cells[textColumn.id] = '长备注用于检查自动换行与展开编辑。'.repeat(24) + '\n第二段：关闭后保留输入。'; } }
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
  const fixtureSources = state==='news-rules-many'||state==='news-source-states'||long ? Array.from({length:30},(_,index)=>({...structuredClone(fixtureSource),config:{...fixtureSource.config,id:index===0?fixtureSource.config.id:`rss-ui-${index}`,name:long?`示例信源 ${index+1} · `+'用于检查名称换行的长标题'.repeat(5):`示例信源 ${index+1}`,enabled:index%3!==0},lastStatus:state==='news-source-states'?(index===0?null:Object.keys(statusLabels)[(index-1)%Object.keys(statusLabels).length] as RunStatus):fixtureSource.lastStatus})) : [fixtureSource];
  const fixtureConfig:EditorialConfig = {...data.config, collectionProxy: state === 'proxy' ? 'http://127.0.0.1:7890' : null, model: state === 'awaitingModel' ? null : state==='processing-config-version'?{provider:'ui-example',id:'new-default-model'}:data.config.model};
  if(state.startsWith('daily-')){fixtureConfig.autoDaily=state!=='daily-paused';fixtureConfig.dailyTime='09:00';}
  const isPhase = Object.hasOwn(processingPhases,state);
  const runStatus: EditorialRun['status'] = state==='processing-config-version'?'running':state==='retry-confirm'?'failed':['failed','awaitingModel','interrupted','cancelled','saving','pendingMaterials'].includes(state) ? state as EditorialRun['status'] : isPhase && state !== 'completed' ? 'running' : 'completed';
  const sampleRun = {...data.run, status: runStatus, error: ['failed','interrupted','awaitingModel'].includes(state) ? failure : null, finishedAt: runStatus==='running' ? null : data.at, processed: runStatus==='completed' ? 1 : 0};
  if(state==='daily-running'||state==='daily-failed'){sampleRun.kind='daily';sampleRun.startedAt=new Date().toISOString();sampleRun.status=state==='daily-running'?'running':'failed';sampleRun.error=state==='daily-failed'?'UI 虚构错误：本次刊期未保存成功，旧版保留。':null;}
  if(state==='pendingMaterials'){sampleRun.total=50;sampleRun.processed=49;sampleRun.error='已保存 49 / 50 条；1 条材料不足，仍保留在待处理列表。';}
  const workspaceRoot = state === 'data-path-prefixed' ? String.raw`\\?\C:\Users\Example\Documents\AZCineData-Release`
    : state === 'data-path-long' ? `C:\\Users\\Example\\OneDrive\\${'影视项目资料与历史记录'.repeat(18)}\\AZCineData-Release` : data.root;
  const [workspace, patchWorkspace] = useFixture(useWorkspace(), {
    rootChangeMode: state === 'data-switch' ? 'switch' : 'migrate', rootChangePath: 'D:\\AZCineData-Release', rootChangeScheduled: state === 'data-change-pending',
    connected: true, workspace: {root: state==='no-root' ? null : workspaceRoot, defaultRoot: data.root, todos: empty ? [] : [{id: data.uuid(50), title: long ? '核对非常长的分镜描述和交付信息'.repeat(15) : '核对分镜与素材（示例）', dueDate: '2026-10-06', projectId: data.project.id, completed: state==='completed', revision: 1, createdAt: data.at}]}, loading, loadError: state==='root-error' ? failure : '',error:error?failure:'',
    rootDraft: data.root, pendingCreate: pending ? {id:data.uuid(50),title:'示例待核对输入',dueDate:null,projectId:null} : null,
    filter:state==='completed'?'completed':'incomplete',undo:state==='undo'?{todo:{id:data.uuid(50),title:'示例待办',dueDate:null,projectId:null,completed:true,revision:1,createdAt:data.at},completed:false}:null,
  });
  const [projects, patchProjects] = useFixture(useProjects(null), {
    projects: empty || ['project-removed', 'project-restore-confirm'].includes(state) ? [] : [sampleProject],
    removedProjects: ['project-removed', 'project-restore-confirm'].includes(state) ? [sampleProject] : [],
    lastDeleted: state === 'project-removed' ? sampleProject : null,
    deletionPending: state === 'project-delete-pending' ? {[sampleProject.id]:{requestId:data.uuid(74),projectId:sampleProject.id,expectedRevision:sampleProject.revision,deleted:true}} : {},
    notices: state === 'project-removed' ? {[`delete:${sampleProject.id}`]:'示例：项目已删除，可恢复。'} : {},
    drafts: {[sampleProject.id]: {content: long ? sampleProject : projectDraft, baseline: 1, dirty}}, loading, loadError: error ? failure : '',
    newName:state==='create-pending'?'新项目名称已保留（示例）':'',newId:state==='create-pending'?data.uuid(71):null,
    busy:state==='project-saving'?sampleProject.id:'',undos:state==='project-undo'?{[sampleProject.id]:projectUndo}:{},
    labelDrafts:state==='stage-error'?{[sampleProject.id]:'示例重复标签'}:{},
    errors: state==='project-delete-error'?{[`delete:${sampleProject.id}`]:'示例：操作失败，原项目和草稿已保留。'}:state==='stage-error'?{[sampleProject.id]:'示例：标签名称重复，输入已保留。'}:error ? {[sampleProject.id]:failure} : {},
    pending: pending ? {[sampleProject.id]: {request: {requestId:data.uuid(51),expectedRevision:1,document:sampleProject}, consumesUndo:false}} : {},
  });
  const [news, patchNews] = useFixture(useNews(null), {
    connected: true, snapshot: {sources: empty ? [] : fixtureSources, runs: empty ? [] : [{id:data.uuid(52),sourceId:fixtureSource.config.id,sourceName:fixtureSource.config.name,sourceRevision:1,startedAt:data.at,attemptedAt:data.at,finishedAt:data.at,status:fixtureSource.lastStatus ?? 'added',fetched:6,added:6,skipped:0,error:fixtureSource.lastError,warning:null,retryStage:fixtureSource.lastError ? 'fetch' : null}]},
    materials: {items:empty ? [] : allMaterials,total:empty ? 0 : 6,page:0,pageSize:50}, drafts: {[fixtureSource.config.id]:{config:fixtureSource.config,baseline:1,dirty}, new:{config:{...fixtureSource.config,id:data.uuid(53),name:'',feedUrl:''},baseline:null,dirty:false}}, loading, materialsLoading: loading, loadError: error ? failure : '',
    newId:'new', collecting:state==='fetching', pending:pending ? {[fixtureSource.config.id]:{requestId:data.uuid(54),expectedRevision:1,source:fixtureSource.config}} : {},
    previews:state==='preview' ? {[fixtureSource.config.id]:{config:fixtureSource.config,result:{kind:'rss',fetchedAt:data.at,total:6,skipped:0,warning:null,entries:allMaterials.map(item=>({...item,externalId:null}))}}} : {},
  });
  const [editorial, patchEditorial] = useFixture(useNewsEditorial(null), {
    connected:true, snapshot:{preferences:{config:fixtureConfig,revision:state==='processing-config-version'?2:1},events:empty ? [] : [sampleEvent],editions:empty ? [] : [{...data.edition,events:[sampleEvent],incomplete:state==='incomplete',gaps:state==='incomplete'?['示例信源不可用，覆盖不完整。']:[]}],runs:empty||state==='daily-waiting'?[]:[sampleRun],pending:empty?0:6,nextDailyAt:null},
    draft:empty?null:{config:state==='processing-config-draft'?{...fixtureConfig,model:{provider:'ui-example',id:'new-default-model'}}:dirty ? {...fixtureConfig,featuredScore:90} : fixtureConfig,revision:state==='processing-config-version'?2:1},pending:pending?{requestId:data.uuid(55),expectedRevision:1,config:fixtureConfig}:null,
    loading,loadError:error?failure:'', active:sampleRun.status==='running'||sampleRun.status==='saving', busy:'',
    tab:state==='daily'||state==='incomplete'?'daily':state==='all'?'all':state==='hot'?'hot':'featured',domain:state==='filtered'?'frontiers':'',
    copyEditionId:data.edition.id, copyText:'示例日报完整内容\n\n'+data.event.draft.summary,
  });
  const progress: ProcessingProgress = {runId:sampleRun.id, phase:state==='processing-config-version'?'waitingModel':isPhase?state:'completed',startedAt:new Date(Date.now()-13000).toISOString(),updatedAt:new Date().toISOString(),batch:1,batches:1,batchSize:1,completed:sampleRun.processed,total:1,pid:null,model:state==='processing-config-version'?sampleRun.config.model:fixtureConfig.model,input:[allMaterials[0]],response:state==='waitingModel'||state==='connecting'||state.startsWith('retryWaiting')?'':JSON.stringify({events:[sampleEvent.draft]},null,2),receivedChars:state==='waitingModel'||state==='connecting'||state.startsWith('retryWaiting')?0:800,steps:[{at:data.at,phase:'preparing'},{at:data.at,phase:'sending'},{at:data.at,phase:isPhase?state:'completed'}],error:sampleRun.error};
  if(state==='pendingMaterials'){progress.total=50;progress.completed=49;progress.batch=50;progress.batches=50;progress.error=sampleRun.error;progress.pendingMaterials=[{materialId:allMaterials[0].id,title:'UI 虚构示例：当前条目没有可用摘要或正文',reason:'公开页面未识别到正文，保留待补，后续资料已继续处理。'}];}
  const [processing, patchProcessing] = useFixture(useNewsProcessing(null,false,false), {
    pending:{items:empty?[]:allMaterials,total:empty?0:6,page:0,pageSize:6},selected:empty?null:allMaterials[0],dailyCount:{total:empty?0:6,at:data.at},progress:state==='normal'||empty?null:progress,loading,error:error?failure:'',
    detail:state==='detail'?{runId:sampleRun.id,batch:1,batches:1,batchSize:1,configRevision:1,rules:fixtureConfig,input:[allMaterials[0]],outputs:[{name:'模型返回',text:progress.response,truncated:false}],result:sampleEvent.draft,progress}:null,
    detailTarget:state==='detail'?{id:sampleRun.id,batch:1}:null,scope:state==='all-scope'?'all':'single',
  });
  const [ideas, patchIdeas] = useFixture(useIdeas(null), {ideas:empty?[]:[sampleIdea],drafts:{new:ideaDraft({...sampleIdea,title:'',body:'',tags:[],projectId:null}),[sampleIdea.id]:sampleIdeaDraft},editing:ideaEditing?{[sampleIdea.id]:true}:{},loading,loadError:error?failure:'',pending:pending?{[sampleIdea.id]:{requestId:data.uuid(56),expectedRevision:1,content:sampleIdea}}:{},deleted:state==='removed',undo:state==='undo'?sampleIdea:null});
  const samplePi = structuredClone(data.piSnapshot);
  if(piState==='agent-models'||state==='provider-multiple'){samplePi.models=Array.from({length:5},(_,index)=>({...data.piSnapshot.models[0],id:`example-model-${index+1}`,name:`示例模型 ${index+1} · ${index%2?'图像与文本':'推理'}`}));samplePi.state={...samplePi.state!,model:samplePi.models[0]};}
  if(sidebarState&&piLong){samplePi.models=samplePi.models.map(model=>({...model,name:'用于检查侧栏中长模型名称的示例推理模型'.repeat(4)}));samplePi.state={...samplePi.state!,sessionName:'用于检查很长会话标题的分镜与交付规格核对'.repeat(8),model:samplePi.models[0]};}
  samplePi.projection.messages=empty?[]:[
    {role:'user',content:[{type:'text',text:'帮我核对分镜与镜头清单，把需要我确认的差异列出来。'}]},
    {role:'assistant',content:[{type:'thinking',thinking:'先核对说明与镜头内容，再检查交付信息。'},{type:'toolCall',id:'ui-read',name:'read',arguments:{path:'ui-example.md'}}],stopReason:'toolUse'},
    {role:'toolResult',toolCallId:'ui-read',toolName:'read',isError:piFailed,content:[{type:'text',text:piFailed?failure:'示例资料中有两项交付信息尚未确认。'}]},
    {role:'assistant',content:[{type:'text',text:piLong?'这是一段用来检查长回复排版的示例内容。'.repeat(100):'有两项需要你确认：\n\n1. 最终交付日期。\n2. 短版是否需要竖屏输出。\n\n以上是虚构资料中的示例，不更新项目记录。'}],stopReason:piFailed?'error':piState==='interrupted'?'aborted':'stop',...(piFailed?{errorMessage:failure}:{})},
  ];
  if(state==='agent-process'){
    samplePi.projection.messages.splice(1,1,{role:'assistant',content:[
      {type:'thinking',thinking:'先核对说明与镜头内容，再检查交付信息。'},
      {type:'text',text:'我先读取现有资料，随后继续核对交付字段。（虚构过程说明）'},
      {type:'toolCall',id:'ui-read',name:'read',arguments:{path:'ui-example.md'}},
    ],stopReason:'toolUse'});
    samplePi.projection.messages.splice(3,0,
      {role:'assistant',content:[
        {type:'thinking',thinking:'继续核对交期与输出规格，这仍是同一轮任务。'},
        {type:'text',text:'资料已读取，继续检查两项交付信息。（虚构过程说明）'},
        {type:'toolCall',id:'ui-check-date',name:'read',arguments:{path:'ui-delivery.md'}},
        {type:'toolCall',id:'ui-check-format',name:'read',arguments:{path:'ui-output.md'}},
      ],stopReason:'toolUse'},
      {role:'toolResult',toolCallId:'ui-check-date',toolName:'read',isError:false,content:[{type:'text',text:'虚构核对：最终交付日期仍需本人确认。'}]},
      {role:'toolResult',toolCallId:'ui-check-format',toolName:'read',isError:false,content:[{type:'text',text:'虚构核对：短版竖屏规格仍需本人确认。'}]},
    );
  }
  if(state==='agent-process-retry')samplePi.projection.messages=[
    {role:'user',content:[{type:'text',text:'把镜头表整理成草案（虚构请求）。'}]},
    {role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'先读取项目动作契约（虚构执行说明）。'},{type:'toolCall',id:'ui-contract',name:'codemode',arguments:{code:'虚构代码，不执行'}}]},
    {role:'toolResult',toolCallId:'ui-contract',toolName:'codemode',isError:false,calls:[{name:'azcine.describe_action',status:'error'}],content:[{type:'text',text:'虚构子调用失败：缺少模块参数。'}]},
    {role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'补充模块参数后继续读取（虚构执行说明）。'},{type:'toolCall',id:'ui-contract-retry',name:'codemode',arguments:{code:'虚构重试代码，不执行'}}]},
    {role:'toolResult',toolCallId:'ui-contract-retry',toolName:'codemode',isError:false,calls:[{name:'azcine.describe_action',status:'ok'}],content:[{type:'text',text:'虚构契约读取完成。'}]},
    {role:'assistant',stopReason:'stop',content:[{type:'text',text:'示例整理完成，等待核对。以下是同一条最终回复中的另一段。'},{type:'text',text:'此处没有调用模型，也没有保存业务记录。'}]},
  ];
  if(state==='agent-answer-table')samplePi.projection.messages=[
    {role:'user',content:[{type:'text',text:'整理表格（虚构请求）。'}]},
    {role:'assistant',stopReason:'stop',content:[{type:'text',text:'以下是虚构镜头表：\n\n| 镜头 | 制作 | 版本记录 |\n| --- | --- | --- |\n| SH_001 | 示例人员 | BCOPY / FINAL |\n| SH_002 | 待确认 | `原文|保留` |\n\n这份回复不写入项目。'}]},
  ];
  if(state==='agent-answer-table-long')samplePi.projection.messages=[
    {role:'user',content:[{type:'text',text:'展示长表格换行（UI虚构请求）。'}]},
    {role:'assistant',stopReason:'stop',content:[{type:'text',text:`以下均为虚构资料，只查看排版：

| 信源 | 可尝试的方式 | 当前确定程度 |
| --- | --- | --- |
| **示例文章信源** | 自建订阅入口，核对公开文章列表和访问规则，保留原始地址。${'长中文说明应在当前单元格内换行，不能覆盖相邻列。'.repeat(5)} | **尚需进一步核对**；不把公开地址当成已经验证可用。 |
| 示例论文列表 | 使用公开接口，URL：\`https://example.com/${'long-path-without-spaces-'.repeat(12)}feed.xml\` | 支持长英文、网址与行内代码换行，保留完整内容。 |

列较多时在表格内部横向滚动：

| 第一列 | 第二列 | 第三列 | 第四列 | 第五列 | 第六列 | 第七列 | 第八列 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 示例 | 中文长内容用于查看换行。 | **加粗内容保留** | 另一段虚构说明。 | \`code-example\` | 第六列内容 | 第七列内容 | 最后一列完整保留 |

没有调用网络、模型或业务保存。`}]},
  ];
  if(state==='agent-send-layout')samplePi.projection.messages=Array.from({length:8},(_,index)=>[
    {role:'user',content:[{type:'text',text:`第 ${index+1} 轮虚构请求：核对交付内容。`}]},
    {role:'assistant',stopReason:'stop',content:[{type:'text',text:'这是UI总览的虚构历史。向上阅读时发送消息应保留阅读位置；在底部时继续跟随。'.repeat(6)}]},
  ]).flat();
  samplePi.projection.outcome=piState==='interrupted'?'interrupted':piFailed?'error':'success';
  if(['agent-process-nested','agent-process-nested-running','agent-process-nested-error'].includes(state)){
    const running=state==='agent-process-nested-running',failed=state==='agent-process-nested-error';
    const parent='ui-codemode',children=[
      {id:`${parent}/1`,name:'azcine.list_items',status:'ok'},
      {id:`${parent}/2`,name:'azcine.read_item',status:'ok'},
      {id:`${parent}/1/1`,name:'azcine.read_item',status:running?'unfinished':failed?'error':'ok'},
    ];
    samplePi.projection.messages=[
      {role:'user',content:[{type:'text',text:'合计示例开销（UI虚构请求）。'}]},
      {role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'先读取示例记录，再核对金额。'},{type:'toolCall',id:parent,name:'codemode',arguments:{code:'UI虚构代码，不执行'}}]},
      ...(running?[]:[{role:'toolResult',toolCallId:parent,toolName:'codemode',isError:false,calls:children,content:[{type:'text',text:'UI虚构工具结果。'}]},
        {role:'assistant',stopReason:'stop',content:[{type:'text',text:failed?'示例核对中有一项失败，请展开同一过程查看。':'示例合计完成；一条已工作包含父调用和三个子调用。'}]}]),
    ];
    samplePi.projection.tools=[{id:parent,name:'codemode',status:running?'running':'finished'},...children.map((child,index)=>({id:child.id,name:child.name,parentToolCallId:index===2?children[0].id:parent,status:child.status==='unfinished'?'running':child.status==='ok'?'finished':child.status}))];
    samplePi.projection.activity=running?'running':'idle';samplePi.projection.outcome=running?'none':'success';
    samplePi.state={...samplePi.state!,isStreaming:running,messageCount:samplePi.projection.messages.length};
  }
  if(state==='agent-waiting'){samplePi.projection.messages=samplePi.projection.messages.slice(0,1);samplePi.projection.partial=null;samplePi.projection.activity='starting';samplePi.projection.outcome='none';}
  if (state==='resource-waiting') samplePi.busy=true;
  if (state==='windows-paths') {
    samplePi.cwd=String.raw`\\?\C:\AZCine-UI-Example\workspaces\default`;
    samplePi.runtime={...samplePi.runtime!,root:String.raw`\\?\C:\AZCine-UI-Example\runtime`};
    samplePi.paths={agent:String.raw`\\?\C:\AZCine-UI-Example\pi\agent`,sessions:String.raw`\\?\UNC\ui-example\azcine\sessions`,defaultCwd:samplePi.cwd};
  }
  if (piState==='running'||piState==='compacting') {samplePi.projection.outcome='none';samplePi.projection.messages.pop();samplePi.projection.partial={role:'assistant',content:[{type:'thinking',thinking:'正在核对示例资料中的镜头信息。'}],stopReason:'pending'};samplePi.projection.activity=piState==='running'?'running':'compacting';samplePi.state={...samplePi.state!,isStreaming:piState==='running',isCompacting:piState==='compacting'};}
  if (state==='queued') {samplePi.projection.steering=['优先核对交付规格（示例）'];samplePi.projection.followUp=['再整理需要确认的镜头（示例）'];samplePi.state={...samplePi.state!,pendingMessageCount:2};}
  if (long) samplePi.paths={agent:'UI fixture / '+ '非常长的资源目录/'.repeat(15),sessions:'UI fixture / 示例会话目录',defaultCwd:data.root};
  if(state==='agent-cold-history'){samplePi.connection='disconnected';samplePi.models=[];}
  if(state==='agent-lazy-start'){samplePi.connection='disconnected';samplePi.state=null;samplePi.models=[];samplePi.projection.messages=[];samplePi.projection.outcome='none';}
  const [agentJobsPreview]=useFixture(useAgentJobs(null),{snapshot:{slots:{limit:2,active:[],queued:[]},jobs:empty?[]:[{id:'ui-fixture-job',template:'summarize-text',input:long?'这是一段检查任务原始输入的虚构资料。'.repeat(40):'整理本周交付需求（虚构输入）',parentId:null,status:error?'failed':'completed',output:error?null:'整理结果：交付时间与版本仍需本人核对。此处是虚构总览，不调用模型。',error:error?'虚构任务失败，输入保留。':null,createdAt:data.at,timeoutMs:600000}],logs:[{jobId:'ui-fixture-job',at:data.at,message:'虚构日志：任务与输入已保存'}]},error:error?'虚构任务读取错误，已有记录保留。':''});
  const [agentDataPreview,patchAgentDataPreview]=useFixture(useAgentData(null),{drafts:['agent-draft-create','agent-draft-update','agent-draft-long','agent-draft-confirm','agent-draft-apply-error','agent-draft-conflict'].includes(state)?[reviewFixture(state)]:['agent-draft-review','agent-draft-decisions'].includes(state)?[{id:'ui-fixture-draft',conversationKey:'default',inputId:'ui-fixture-input',messageKey:'mcp:ui-preview:ui-fixture-input:demo',payload:{version:1,operations:[],decisions:state==='agent-draft-decisions'?['截图日期尚未确认，保留原交付日期（虚构事项）']:[]},context:{messageCount:0,objects:[]},validation:{error:null,items:[{title:'示例项目 · 交付标题',objectId:'ui-fixture-object',action:'update',actionLabel:'更新标题',before:{title:'分镜初版'},proposed:{title:'分镜核对版（虚构建议）'}}]},status:'review',receipt:null,revision:1,createdAt:data.at}]:[]});
  const [pi, patchPi] = useFixture(usePi(null), {connected:true,root:data.root,snapshot:state==='disconnected'?null:{...samplePi,extensions:piState==='agent-extension'?{requests:[{id:'ui-fixture-question',method:'select',title:'资料已读取，下一步怎么处理？',message:'这是总览内的虚构问题。',options:['先核对来源','保留输入，暂不处理'],placeholder:'',prefill:'',status:'pending',expiresAt:null}],notifications:[{id:'ui-fixture-notice',message:'正在等待本人选择',tone:'info'}],statuses:{task:'资料完整，等待回答'},widgets:{},title:'示例扩展',editor:null}:undefined,connection:state==='agent-connect-error'?'error':state==='agent-cold-history'||state==='agent-lazy-start'?'disconnected':piState==='connecting'?'connecting':piFailed?'error':'ready',error:piFailed||state==='agent-connect-error'?{code:'ui-fixture',message:failure}:null},error:piFailed||state==='agent-connect-error'?failure:null,
    ...(state==='agent-send-layout'?{draft:{text:'这是多行虚构输入。\n发送只改变本页内存状态。\n清空输入框并显示新消息和等待状态。\n用于查看消息区域是否跳动。\n不会请求模型或写业务库。\n可以先向上阅读再发送。',images:[]}}:{}),
    sessions:empty?[]:Array.from({length:['agent-sessions','agent-session-status','agent-session-pinned','agent-session-manage','agent-session-pin-action','agent-bulk-delete','agent-sessions-collapsed'].includes(state)?8:1},(_,index)=>({id:data.uuid(42+index),path:`UI fixture / session-${index}`,name:long?'用于检查很长会话名称的示例标题'.repeat(10):`分镜与交付核对 ${index+1}（示例）`,cwd:data.root,updatedAt:data.at,messageCount:4+index})),displayRunStart:0,sessionName:'示例会话名称',
    sessionPins:['agent-session-pinned','agent-session-manage','agent-sessions-collapsed'].includes(state)?[data.uuid(46),data.uuid(49)]:[],
    ...(['agent-session-status','agent-session-pinned','agent-session-manage','agent-session-pin-action'].includes(state)?{conversationKey:'ui-status-0',runtimeSummary:{replyLimit:3,revision:1,active:1,conversations:[
      {name:'交付核对（空闲示例）',connection:'ready',active:false,waiting:false},
      {name:'正在整理镜头表（运行示例）',connection:'ready',active:true,waiting:false},
      {name:'需要本人确认（待回答示例）',connection:'ready',active:false,waiting:true},
      {name:'读取会话中（连接示例）',connection:'connecting',active:false,waiting:false},
      {name:'连接失败（异常示例）',connection:'error',active:false,waiting:false},
      {name:'已保留的会话（未连接示例）',connection:'disconnected',active:false,waiting:false},
    ].map((row,index)=>({...row,conversationKey:`ui-status-${index}`,generation:1,seq:1,sessionId:data.uuid(42+index),sessionFile:`UI fixture / session-${index}`,outcome:'none',cwd:data.root}))}}:{}),
    ...(state==='attachments'||state==='agent-connect-error'?{
      draft:{text:'这是带附件的示例消息',images:[{id:data.uuid(60),name:'ui-example.png',mimeType:'image/png',data:data.attachmentImageData}]},
      files:[{id:data.uuid(61),name:'镜头表.xlsx',relativePath:'attachments/ui-example.xlsx',hash:'0'.repeat(64),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:2048},{id:data.uuid(62),name:'交付说明.pdf',relativePath:'attachments/ui-example.pdf',hash:'0'.repeat(64),mimeType:'application/pdf',bytes:4096}],
    }:{}),
  });
  const [agentObjectsOpen,setAgentObjectsOpen]=useState(state==='agent-objects'),[agentObjectQuery,setAgentObjectQuery]=useState(''),[agentSelected,setAgentSelected]=useState<import('../pi-client.ts').AgentSource[]>([]);
  const previewObjects=[{source:{module:'projects',page:'projects/'+data.project.id,objectId:data.project.id},title:'示例公司 · 交付安排（虚构记录）'}];
  const agentObjects={...pi.objects,open:agentObjectsOpen,setOpen:setAgentObjectsOpen,query:agentObjectQuery,setQuery:setAgentObjectQuery,catalog:{modules:[{id:'projects',label:'公司项目',objects:previewObjects.filter(object=>object.title.includes(agentObjectQuery)),total:1}]},loading:false,error:'',objects:agentSelected,show:()=>setAgentObjectsOpen(true),toggle:(source:import('../pi-client.ts').AgentSource)=>setAgentSelected(previous=>previous.some(item=>item.objectId===source.objectId)?previous.filter(item=>item.objectId!==source.objectId):[...previous,source])};
  const providerItems:ProviderDraft[]=Array.from({length:state==='provider-multiple'?4:1},(_,index):ProviderDraft=>({...structuredClone(data.provider),uid:data.uuid(80+index),provider:`ui-example-${index+1}`,dirty,tab:state==='models'||state==='provider-interface'||state==='provider-multiple'?'models':state==='advanced'||state==='provider-thinking'?'advanced':'connection',fetching:state==='provider-fetching',models:state==='provider-multiple'||state==='provider-thinking'?Array.from({length:4},(_,modelIndex)=>({...data.provider.models[0],uid:data.uuid(100+index*10+modelIndex),id:`example-${index}-${modelIndex}`,name:`示例模型 ${modelIndex+1}`,thinkingLevelMap:defaultThinkingMap(),defaultThinkingLevel:'medium' as const})):data.provider.models,remote:state==='remote'?{models:[{id:'example-new-model',name:'远程示例模型',contextWindow:64000,maxTokens:4096,supportsImages:true}],truncated:false}:null,error:error?failure:null}));
  const [providers, patchProviders] = useFixture(usePiProviders(null,false,pi), {ready:true,providers:empty?[]:providerItems,active:undefined,saving:state==='provider-saving'?providerItems[0].uid:null,loading,loadError:error?failure:null});
  const [rankings, patchRankings] = useFixture(useModelRanking(null,false), {connected:true,selected:state==='ranking-image-brands'?'text-to-image':'agent',boards:{agent:empty?{...data.board('agent'),snapshot:null}:data.board('agent',long),'text-to-image':empty?{...data.board('text-to-image'),snapshot:null}:data.board('text-to-image',long)},loading,loadError:error?failure:'',busy:state==='busy'?{board:'agent',action:'fetch'}:null});
  const [desktop, patchDesktop] = useFixture(useDesktopCheck(), {connected:true,state:loading?{status:'loading'}:error?{status:'error',message:failure}:state==='success'?{status:'success',report:{requestId:1,sqliteVersion:'示例',appVersion:'示例',storage:"temporary",roundTrip:true,rollback:true}}:{status:'idle'}});
  const [notice, setNotice] = useOperationNotice('');
  const announce = () => {setNotice(message);};
  const action = async () => {announce();};
  function changeProvider(uid:string,update:(item:ProviderDraft)=>ProviderDraft) {patchProviders(before=>({providers:before.providers.map(item=>item.uid===uid?update(item):item)}));}
  const active = providers.providers.find(item=>item.uid===providers.active?.uid) ?? providers.providers[0];
  const resourcePreview = usePreviewResources(pi.resources, state);
  const [resetRequest,setResetRequest] = useState<typeof news.reset.request>(null);
  const previewReset = {...news.reset,request:resetRequest,busy:false,error:'',
    prepare:async(mode:NewsResetMode)=>{
      if(!isHistoryReset(mode)){notifyOperation(message);return;}
      const runs=editorial.snapshot?.runs??[], target=mode.slice('history:'.length);
      const count=runs.filter(run=>!['running','saving'].includes(run.status)&&(mode==='history'||run.id===target)).length;
      setResetRequest({mode,token:'0'.repeat(64),requestId:crypto.randomUUID(),materials:0,articles:0,editions:0,tasks:count});
    },cancel:()=>setResetRequest(null),confirm:async()=>{
      if(!resetRequest)return;
      const target=resetRequest.mode.slice('history:'.length), all=resetRequest.mode==='history';
      patchEditorial(before=>({snapshot:before.snapshot?{...before.snapshot,runs:before.snapshot.runs.filter(run=>['running','saving'].includes(run.status)||(!all&&run.id!==target))}:null}));
      patchProcessing(before=>({progress:all||before.progress?.runId===target?null:before.progress,detail:all||before.detailTarget?.id===target?null:before.detail,detailTarget:all||before.detailTarget?.id===target?null:before.detailTarget}));
      setResetRequest(null);notifyOperation('示例处理记录已移出列表，资料与资讯保留。',{tone:'success'});
    }};

  const projectListRef=useRef(projects);projectListRef.current=projects;
  async function previewProjectDeletion(project: ProjectDocument, deleted: boolean) {
    const current = (deleted ? projectListRef.current.projects : projectListRef.current.removedProjects).find(item => item.id === project.id);
    if (!current || current.revision !== project.revision) return false;
    const next = { ...current, revision: current.revision + 1 };
    patchProjects(before => ({
      projects: deleted ? before.projects.filter(item => item.id !== project.id) : [...before.projects, next],
      removedProjects: deleted ? [...before.removedProjects, next] : before.removedProjects.filter(item => item.id !== project.id),
      lastDeleted: deleted ? next : null,
      deletionPending: Object.fromEntries(Object.entries(before.deletionPending).filter(([id]) => id !== project.id)),
      drafts: before.drafts[project.id]?.dirty ? before.drafts : { ...before.drafts, [project.id]: {content: next,baseline:next.revision,dirty:false} },
      errors: { ...before.errors, [`delete:${project.id}`]: '' },
      notices: { ...before.notices, [`delete:${project.id}`]: deleted ? 'UI 示例：项目已移入“已删除”，可撤销。' : 'UI 示例：项目已恢复。' },
    }));
    notifyOperation(deleted ? `示例项目“${next.name}”已删除。` : '示例项目已恢复。', {tone:'success', ...(deleted ? {action:{label:'撤销',run:async()=>{await previewProjectDeletion(next,false);}}} : {})});
    return true;
  }
  return {
    bookkeeping, taskPanelPreview, environmentPreview, notice, clearNotice:()=>setNotice(''),
    workspace:{...workspace,setRootChangePath:value=>patchWorkspace(before=>({rootChangePath:typeof value==='function'?value(before.rootChangePath):value})),setRootChangeMode:value=>patchWorkspace(before=>({rootChangeMode:typeof value==='function'?value(before.rootChangeMode):value})),pickRootChange:action,scheduleRootChange:async()=>{if(state==='data-change-failed'){patchWorkspace({error:'示例：目标目录不是空目录，原记录保留。',errorScope:'change-root'});return false;}patchWorkspace({rootChangeScheduled:true});return true;},cancelRootChange:async()=>patchWorkspace({rootChangeScheduled:false}),changeDeletion:async(todo,deleted)=>{patchWorkspace(before=>({deletedTodo:deleted?{...todo,revision:todo.revision+1}:null,workspace:before.workspace?{...before.workspace,todos:deleted?before.workspace.todos.filter(row=>row.id!==todo.id):[...before.workspace.todos,{...todo,revision:todo.revision+1}]}:null}));announce();return true;},setFilter:(value)=>patchWorkspace(before=>({filter:typeof value==='function'?value(before.filter):value})),changeRoot:(value:string)=>patchWorkspace({rootDraft:value}),changeDraft:(field,value)=>patchWorkspace(before=>({draft:{...before.draft,[field]:value}})),refresh:action,pickRoot:action,selectRoot:action,openRoot:action,saveTodo:action,reconcileCreate:action,changeCompletion:async(todo,completed)=>patchWorkspace(before=>({workspace:before.workspace?{...before.workspace,todos:before.workspace.todos.map(item=>item.id===todo.id?{...item,completed}:item)}:null}))},
    projects:{...projects,setDeleted:previewProjectDeletion,reconcileDeletion:async(id)=>{
      const request=projects.deletionPending[id],project=[...projects.projects,...projects.removedProjects].find(item=>item.id===id);
      if(request&&project) await previewProjectDeletion(project,request.deleted);
    },refresh:action,changeQuery:value=>patchProjects(before=>({query:typeof value==='function'?value(before.query):value})),changeNewName:value=>patchProjects({newName:value}),change:(id,update)=>{patchProjects(before=>({drafts:{...before.drafts,[id]:{...before.drafts[id],content:update(before.drafts[id].content),dirty:true}}}));return true;},save:action,create:async()=>{announce();return null;},reconcile:action,rebase:announce,replaceWithOfficial:announce,changeLabelDraft:(id,value,labelId)=>patchProjects(before=>({labelDrafts:{...before.labelDrafts,[labelId?`${id}/${labelId}`:id]:value}})),putUndo:(id,value)=>patchProjects(before=>({undos:value?{...before.undos,[id]:value}:Object.fromEntries(Object.entries(before.undos).filter(([key])=>key!==id))}))},
    news:{...news,reset:previewReset,refresh:action,readMaterials:action,collect:action,cancelCapture:action,saveSource:action,reconcile:action,preview:async(id)=>patchNews(before=>({previews:{...before.previews,[id]:{config:before.drafts[id].config,result:{kind:'rss',fetchedAt:data.at,total:6,skipped:0,warning:null,entries:allMaterials.map(item=>({...item,externalId:null}))}}}})),changeFilter:(value)=>patchNews({filter:value}),changeDraft:(id,update)=>patchNews(before=>({drafts:{...before.drafts,[id]:{...before.drafts[id],config:{...before.drafts[id].config,...update},dirty:true}}})),startNew:()=>"new",toggle:async(item)=>patchNews(before=>({snapshot:{...before.snapshot,sources:before.snapshot.sources.map(s=>s.config.id===item.config.id?{...s,config:{...s.config,enabled:!s.config.enabled}}:s)}})),useLatest:announce,openOriginal:action},
    editorial:{...editorial,refresh:action,save:action,reconcile:action,setTab:(value)=>patchEditorial(before=>({tab:typeof value==='function'?value(before.tab):value})),setDomain:(value)=>patchEditorial(before=>({domain:typeof value==='function'?value(before.domain):value})),changeConfig:(value)=>patchEditorial(before=>({draft:before.draft?{...before.draft,config:value}:null})),rebase:announce,organize:async()=>{await action();return undefined;},cancel:action,analyze:action,copy:action,exportPdf:action,readEditionText:async()=>`AZCine 示例日报 · 2026-10-04\n\n${sampleEvent.draft.title}\n\n${sampleEvent.draft.summary}\n\n来源：${data.materials[0].url}\n\n全部为 UI 虚构资料，不代表真实资讯。`},
    processing:{...processing,setScope:value=>patchProcessing(before=>({scope:typeof value==='function'?value(before.scope):value})),setBatchSize:value=>patchProcessing(before=>({batchSize:typeof value==='function'?value(before.batchSize):value})),setQuery:value=>patchProcessing(before=>({query:typeof value==='function'?value(before.query):value})),setSource:value=>patchProcessing(before=>({source:typeof value==='function'?value(before.source):value})),setEventQuery:value=>patchProcessing(before=>({eventQuery:typeof value==='function'?value(before.eventQuery):value})),select:(value)=>patchProcessing({selected:typeof value==='function'?value(processing.selected):value}),refresh:action,readProgress:action,inspect:async(id,batch=1)=>patchProcessing({detailTarget:{id,batch},detail:{runId:id,batch,batches:1,batchSize:1,configRevision:1,rules:fixtureConfig,input:[allMaterials[0]],outputs:[{name:'模型返回',text:progress.response,truncated:false}],result:sampleEvent.draft,progress}})},
    ideas:{...ideas,refresh:action,save:action,reconcile:action,remove:action,convert:action,continueOnCurrent:action,setDeleted:(value)=>patchIdeas(before=>({deleted:typeof value==='function'?value(before.deleted):value})),changeDraft:(key,field,value)=>patchIdeas(before=>({drafts:{...before.drafts,[key]:{...before.drafts[key],[field]:value}}})),edit:(item)=>patchIdeas(before=>({editing:{...before.editing,[item.id]:true}})),closeEdit:(id)=>patchIdeas(before=>({editing:{...before.editing,[id]:false}}))},
    agentJobsPreview:{...agentJobsPreview,submit:action,cancel:action,refresh:action},agentDataPreview:{...agentDataPreview,revalidate:async(draft)=>{patchAgentDataPreview(before=>({drafts:before.drafts.map(d=>d.id===draft.id?{...d,status:"review",revision:d.revision+1,validation:{...d.validation,error:null}}:d)}));},apply:async(draft)=>{if(state==='agent-draft-apply-error'){patchAgentDataPreview(before=>({error:draftApplyFailure,drafts:before.drafts.map(d=>d.id===draft.id?{...d,status:'blocked',revision:d.revision+1,validation:{...d.validation,error:draftApplyFailure}}:d)}));return false;}patchAgentDataPreview(before=>({drafts:before.drafts.map(d=>d.id===draft.id?{...d,status:"applied",receipt:{fixture:true,items:[]}}:d)}));announce();return true;},discard:async(draft)=>{patchAgentDataPreview(before=>({drafts:before.drafts.filter(d=>d.id!==draft.id)}));announce();},refresh:action},
    pi:{...pi,setSessionPinned:(sessionId,pinned)=>patchPi(previous=>({sessionPins:pinned?previous.sessionPins.includes(sessionId)?previous.sessionPins:[...previous.sessionPins,sessionId]:previous.sessionPins.filter(id=>id!==sessionId)})),deleteConversations:async(targets)=>{const protectedId=pi.snapshot?.projection.activity!=="idle"?pi.snapshot?.state?.sessionId:null;const removed=targets.filter(t=>t.sessionId!==protectedId);patchPi(before=>({sessions:before.sessions.filter(session=>!removed.some(t=>t.sessionId===session.id)),sessionPins:before.sessionPins.filter(id=>!removed.some(t=>t.sessionId===id)),runtimeSummary:before.runtimeSummary?{...before.runtimeSummary,conversations:before.runtimeSummary.conversations.filter(row=>!removed.some(t=>t.sessionId===row.sessionId))}:null}));announce();return{deleted:removed.map(t=>t.sessionId),errors:targets.filter(t=>t.sessionId===protectedId).map(t=>({sessionId:t.sessionId,error:"运行中的示例会话不能删除。"}))};},newConversation:action,selectConversation:action,selectSession:action,deleteConversation:async(target)=>{if(pi.snapshot?.projection.activity!=="idle"&&target.sessionId===pi.snapshot?.state?.sessionId)return {deleted:false,error:"运行中的示例会话不能删除。"};patchPi(before=>({sessions:before.sessions.filter(session=>session.path!==target.sessionPath),sessionPins:before.sessionPins.filter(id=>id!==target.sessionId),runtimeSummary:before.runtimeSummary?{...before.runtimeSummary,conversations:before.runtimeSummary.conversations.filter(row=>row.sessionId!==target.sessionId)}:null}));announce();return {deleted:true};},attachFile:async()=>{announce();},removeFile:()=>announce(),objects:agentObjects,resources:resourcePreview,openSource:async()=>{},respondUi:async(id)=>patchPi(before=>({snapshot:before.snapshot?{...before.snapshot,extensions:before.snapshot.extensions?{...before.snapshot.extensions,requests:before.snapshot.extensions.requests.map(r=>r.id===id?{...r,status:'answered'}:r)}:undefined}:null})),setSessionName:value=>patchPi(before=>({sessionName:typeof value==='function'?value(before.sessionName):value})),setText:(text)=>patchPi(before=>({draft:{...before.draft,text}})),setImages:(images)=>patchPi(before=>({draft:{...before.draft,images}})),refresh:action,reloadSessions:action,connect:action,disconnect:action,send:async()=>{if(state!=='agent-send-layout'){await action();return;}patchPi(before=>({draft:{text:'',images:[]},snapshot:before.snapshot?{...before.snapshot,projection:{...before.snapshot.projection,messages:[...before.snapshot.projection.messages,{role:'user',content:[{type:'text',text:before.draft.text}]}],partial:null,activity:'starting',outcome:'none'}}:null}));},stop:action,renameConversation:async(target,name)=>{const clean=name.trim();if(!clean||Array.from(clean).length>200)throw new Error('示例：请填写1–200字的会话名称。');patchPi(before=>({sessions:before.sessions.map(row=>row.id===target.sessionId?{...row,name:clean}:row),runtimeSummary:before.runtimeSummary?{...before.runtimeSummary,conversations:before.runtimeSummary.conversations.map(row=>row.sessionId===target.sessionId?{...row,name:clean}:row)}:null,snapshot:before.snapshot?.state?.sessionId===target.sessionId?{...before.snapshot,state:{...before.snapshot.state,sessionName:clean}}:before.snapshot}));notifyOperation('示例：会话已重命名。');},sessionAction:async(command,args)=>{if(command==='pi_thinking'){patchPi(before=>({snapshot:before.snapshot?{...before.snapshot,state:before.snapshot.state?{...before.snapshot.state,thinkingLevel:String(args?.level??'medium')}:null}:null}));}else await action();},saveModel:async()=>{announce();return false;},saveConfiguration:async()=>{announce();return null;}},
    providers:{...providers,active,reload:action,select:(uid)=>patchProviders({active:providers.providers.find(item=>item.uid===uid)}),addProvider:()=>{const item={...data.provider,uid:crypto.randomUUID(),provider:`provider-${providers.providers.length+1}`,persisted:false,dirty:true,models:[]};patchProviders(before=>({providers:[...before.providers,item],active:item}));},ui:(uid,patch)=>changeProvider(uid,item=>({...item,...patch})),edit:(uid,patch)=>changeProvider(uid,item=>({...item,...patch,dirty:true})),editModel:(uid,modelUid,patch)=>changeProvider(uid,item=>({...item,dirty:true,models:item.models.map(m=>m.uid===modelUid?{...m,...patch}:m)})),addManual:(uid)=>changeProvider(uid,item=>({...item,models:[...item.models,{...data.provider.models[0],uid:crypto.randomUUID(),id:'',name:'',persisted:false}],tab:'models',dirty:true})),removeNew:(uid,modelUid)=>changeProvider(uid,item=>({...item,models:item.models.filter(m=>m.uid!==modelUid)})),addSelected:(uid)=>changeProvider(uid,item=>({...item,models:[...item.models,...(item.remote?.models.filter(m=>item.selectedIds.includes(m.id)).map(m=>({...data.provider.models[0],uid:crypto.randomUUID(),id:m.id,name:m.name,persisted:false}))??[])],dirty:true,selectedIds:[]})),fetchModels:async(uid)=>changeProvider(uid,item=>({...item,remote:{models:[{id:'example-new-model',name:'远程示例模型',contextWindow:64000,maxTokens:4096,supportsImages:true}],truncated:false}})),save:action},
    rankings:{...rankings,setSelected:selected=>patchRankings(before=>({selected:typeof selected==='function'?selected(before.selected):selected})),refresh:action,update:action,cancel:announce,openSource:action},desktop:{...desktop,check:async()=>patchDesktop({state:{status:'error',message:'UI 总览不执行数据库检查；成功样式请切换到成功状态。'}})},
  } satisfies {environmentPreview: import('../use-dev-environment.ts').EnvironmentController;taskPanelPreview: import('../use-task-panel.ts').TaskPanelController;agentDataPreview:typeof agentDataPreview;agentJobsPreview:typeof agentJobsPreview;bookkeeping:typeof bookkeeping;notice:string;clearNotice:()=>void;workspace:typeof workspace;projects:typeof projects;news:typeof news;editorial:typeof editorial;processing:typeof processing;ideas:typeof ideas;pi:typeof pi;providers:typeof providers;rankings:typeof rankings;desktop:typeof desktop};
}
