import { messageView, toolResultText } from './pi-messages.ts';
import type { MessagePart, MessageView } from './pi-messages.ts';
import type { PiProjection } from './pi-client.ts';

export interface ToolView {
  kind: 'tool'; key: string; id: string; name: string; status: string;
  input: string; output: string; path: string | null; notice: string | null;
  children: {name:string;status:string}[];
}
export interface ThinkingView { kind: 'thinking'; key: string; text: string; title: string }
export interface CommentaryView { kind:'commentary'; key:string; text:string }
export interface ProcessView {
  kind: 'process'; key: string; entries: (ToolView | ThinkingView | CommentaryView)[];
  errors: string[]; live: boolean; activity: string; lastMessage: number;
  terminal: MessageView['status'] | null;
}
export interface TextView {
  kind: 'message'; key: string; role: string; title: string;
  parts: MessagePart[]; status: MessageView['status']; error: string | null;
  messageIndex?: number;
}
export type ConversationView = ProcessView | TextView;
const exceptional = new Set(['error', 'interrupted', 'incomplete']);
export const processHasIssue = (view: ProcessView) => view.errors.length > 0
  || exceptional.has(view.terminal??'')
  || view.entries.some(entry => entry.kind === 'tool' && exceptional.has(entry.status));
export const processFinished = (view:ProcessView)=>!view.live&&view.terminal==='success';
function nestedCalls(raw:unknown):{name:string;status:string}[] {
  if(typeof raw!=='object'||raw===null||!('calls' in raw)||!Array.isArray(raw.calls))return [];
  return raw.calls.flatMap(call=>typeof call==='object'&&call!==null&&typeof call.name==='string'&&typeof call.status==='string'
    ?[{name:call.name,status:({ok:'success',aborted:'interrupted',cancelled:'interrupted'} as Record<string,string>)[call.status]??call.status}]:[]);
}
function toolStatus(status:string,children:{status:string}[]) {
  if(children.some(c=>c.status==='error'))return 'error';
  if(children.some(c=>c.status==='interrupted'))return 'interrupted';
  if(children.some(c=>!['success','finished','running','waiting'].includes(c.status)))return 'incomplete';
  if(['success','finished'].includes(status)&&children.some(c=>['running','waiting'].includes(c.status)))return 'incomplete';
  return status;
}
export function activityText(activity: string) {
  return ({ starting: '等待模型响应', stopping: '正在停止', compacting: '正在整理上下文',
    thinking: '思考中', executing: '执行中', answering: '生成回答', running: '处理中', idle: '已结束' } as Record<string,string>)[activity] ?? '状态待确认';
}
function pathFrom(input: string): string | null {
  try { const args = JSON.parse(input); for (const name of ['path','file_path','filePath']) {
    if (typeof args?.[name] === 'string' && args[name]) return args[name];
  } } catch { /* An incomplete input stays visible as text. */ }
  return null;
}
function argsText(args: unknown): string {
  try { return JSON.stringify(args ?? {}, null, 2) ?? '参数未提供'; }
  catch { return '参数无法显示'; }
}

/** Pure display adaptation of already scrubbed snapshots. Does not write sessions or infer missing history. */
export function conversationView(projection: PiProjection, context: string, runStart = projection.messages.length): ConversationView[] {
  const messages = [...projection.messages, ...(projection.partial == null ? [] : [projection.partial])];
  const views = messages.map(messageView), output: ConversationView[] = [];
  const results = new Map<string, {view:MessageView;raw:unknown}>();
  const callCounts = new Map<string, number>();
  for (const [index,view] of views.entries()) {
    if (view.role === 'toolResult' && view.toolCallId) results.set(view.toolCallId, {view,raw:messages[index]});
    for (const part of view.parts) if (part.kind === 'toolCall' && part.callId) {
      callCounts.set(part.callId, (callCounts.get(part.callId) ?? 0) + 1);
    }
  }
  const liveTools = new Map(projection.tools.map(tool => [tool.id, tool]));
  const used = new Set<string>();
  let current: ProcessView | null = null;
  let turnStart=0;
  function process(index: number): ProcessView {
    if (!current) { current = { kind:'process', key:`${context}/turn/${turnStart}/process`, entries:[], errors:[], live:false, activity:'idle',lastMessage:index,terminal:null }; output.push(current); }
    current.lastMessage=index;
    return current;
  }
  function text(key: string, view: MessageView, parts = view.parts, messageIndex?:number) {
    output.push({kind:'message',key,role:view.role,title:view.title,parts,status:view.status,error:view.error,messageIndex});
  }
  views.forEach((view, index) => {
    // Pi can emit an empty system message at turn start; it has no display content.
    if(view.role==='system'&&!view.error&&view.parts.every(part=>part.kind==='text'&&!part.text.trim()))return;
    const key = `${context}/message/${index}`;
    const partial = index === projection.messages.length && projection.partial != null;
    const raw=messages[index];
    const intermediate=typeof raw==='object'&&raw!==null&&'stopReason' in raw&&raw.stopReason==='toolUse'
      ||view.parts.some(part=>part.kind==='toolCall');
    if(intermediate&&view.status==='incomplete'&&!view.error)view.status='plain';
    if (view.role === 'toolResult' && view.toolCallId && callCounts.get(view.toolCallId) === 1) return;
    if (view.role !== 'assistant') { current = null; turnStart=index; text(key, view.role==='toolResult'?{...view,title:view.title+'（未关联调用）'}:view,view.parts,index); return; }
    const answer:MessagePart[]=[];
    view.parts.forEach((part, block) => {
      const partKey = `${key}/block/${block}`;
      if (part.kind === 'thinking') {
        const group = process(index);
        group.entries.push({kind:'thinking',key:partKey,text:part.text,title:part.title ?? '思考'});
        group.live ||= partial;
      } else if (part.kind === 'toolCall' && part.callId) {
        const group = process(index), id = part.callId;
        const duplicate = callCounts.get(id)! > 1;
        const live = duplicate ? undefined : liveTools.get(id);
        const linked = duplicate ? undefined : results.get(id),result=linked?.view;
        const children=nestedCalls(linked?.raw??live?.result);
        const status = toolStatus(result ? result.status : live?.status ?? (partial ? 'waiting' : 'incomplete'),children);
        const input = part.text;
        group.entries.push({kind:'tool',key:partKey,id,name:part.title ?? '未知工具',status,input,
          output:result ? result.parts.map(p=>p.text).join('\n') : live?.result == null ? '' : toolResultText(live.result),
          path:pathFrom(input),notice:duplicate ? '调用ID重复，未猜测结果归属。' : result?.error ?? null,children});
        used.add(id); group.live ||= partial || status === 'running';
      } else if(intermediate&&part.kind==='text') {
        if(part.text.trim())process(index).entries.push({kind:'commentary',key:partKey,text:part.text});
      } else { answer.push(part); }
    });
    if(answer.length)text(`${key}/answer`,view,answer,index);
    if (view.error && !answer.length) {
      process(index).errors.push(view.error);
    }
    if (view.status === 'interrupted' && !view.error) process(index).errors.push('这段消息已中断，未当作完成。');
    if (view.status === 'incomplete' && !view.error && !partial && !intermediate
      && !view.parts.some(part=>part.kind==='text')) process(index).errors.push('回复未完整结束，请核对原生会话。');
    // Assistant commentary is ordinary text, not a new work round. Keep the
    // same process across toolUse messages; close it at a terminal response.
    if (!partial && (!intermediate||['error','interrupted'].includes(view.status))) {
      if(current){current.terminal=view.status;current.lastMessage=index;}
      current=null;turnStart=index+1;
    }
  });
  // Event-only tools have no reliable position in the message stream. Preserve them with an explicit notice.
  for (const tool of projection.tools) {
    if (used.has(tool.id)) continue;
    const group = process(projection.messages.length), input = argsText(tool.args);
    const children=nestedCalls(tool.result);
    group.entries.push({kind:'tool',key:`${context}/tool/${tool.id}`,id:tool.id,name:tool.name,status:toolStatus(tool.status,children),children,
      input,output:tool.result == null ? '' : toolResultText(tool.result),path:pathFrom(input),
      notice:'仅有工具事件，原消息位置未记录。'});
    group.live ||= tool.status === 'running';
  }
  const active = output.filter((unit): unit is ProcessView => unit.kind === 'process'
    && (unit.live || projection.activity!=='idle'&&unit.lastMessage>=runStart));
  for (const group of active) {
    group.live=projection.activity!=='idle';
    if (projection.activity === 'stopping' || projection.activity === 'compacting') group.activity = projection.activity;
    else if (group.entries.some(entry => entry.kind === 'tool' && entry.status === 'running')) group.activity = 'executing';
    else group.activity = 'running'; // The snapshot does not expose the currently active content block.
    if (projection.activity === 'idle') group.live = false;
  }
  return output;
}
