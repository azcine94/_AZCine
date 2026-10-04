import { messageView, toolResultText } from './pi-messages.ts';
import type { MessagePart, MessageView } from './pi-messages.ts';
import type { PiProjection } from './pi-client.ts';

export interface ToolView {
  kind: 'tool'; key: string; id: string; name: string; status: string;
  input: string; output: string; path: string | null; notice: string | null;
}
export interface ThinkingView { kind: 'thinking'; key: string; text: string; title: string }
export interface ProcessView {
  kind: 'process'; key: string; entries: (ToolView | ThinkingView)[];
  errors: string[]; live: boolean; activity: string; lastMessage: number;
}
export interface TextView {
  kind: 'message'; key: string; role: string; title: string;
  parts: MessagePart[]; status: MessageView['status']; error: string | null;
}
export type ConversationView = ProcessView | TextView;
const exceptional = new Set(['error', 'interrupted', 'incomplete']);
export const processHasIssue = (view: ProcessView) => view.errors.length > 0
  || view.entries.some(entry => entry.kind === 'tool' && exceptional.has(entry.status));
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
  const results = new Map<string, MessageView>();
  const callCounts = new Map<string, number>();
  for (const view of views) {
    if (view.role === 'toolResult' && view.toolCallId) results.set(view.toolCallId, view);
    for (const part of view.parts) if (part.kind === 'toolCall' && part.callId) {
      callCounts.set(part.callId, (callCounts.get(part.callId) ?? 0) + 1);
    }
  }
  const liveTools = new Map(projection.tools.map(tool => [tool.id, tool]));
  const used = new Set<string>();
  let current: ProcessView | null = null;
  function process(key: string, index: number): ProcessView {
    if (!current) { current = { kind:'process', key, entries:[], errors:[], live:false, activity:'idle',lastMessage:index }; output.push(current); }
    current.lastMessage=index;
    return current;
  }
  function text(key: string, view: MessageView, parts = view.parts) {
    current = null;
    output.push({kind:'message',key,role:view.role,title:view.title,parts,status:view.status,error:view.error});
  }
  views.forEach((view, index) => {
    // Pi can emit an empty system message at turn start; it has no display content.
    if(view.role==='system'&&!view.error&&view.parts.every(part=>part.kind==='text'&&!part.text.trim()))return;
    const key = `${context}/message/${index}`;
    const partial = index === projection.messages.length && projection.partial != null;
    const raw=messages[index];
    const intermediate=typeof raw==='object'&&raw!==null&&'stopReason' in raw&&raw.stopReason==='toolUse';
    if(intermediate&&view.status==='incomplete'&&!view.error)view.status='plain';
    if (view.role === 'toolResult' && view.toolCallId && callCounts.get(view.toolCallId) === 1) return;
    if (view.role !== 'assistant') { text(key, view.role==='toolResult'?{...view,title:view.title+'（未关联调用）'}:view); return; }
    view.parts.forEach((part, block) => {
      const partKey = `${key}/block/${block}`;
      if (part.kind === 'thinking') {
        const group = process(partKey,index);
        group.entries.push({kind:'thinking',key:partKey,text:part.text,title:part.title ?? '思考'});
        group.live ||= partial;
      } else if (part.kind === 'toolCall' && part.callId) {
        const group = process(partKey,index), id = part.callId;
        const duplicate = callCounts.get(id)! > 1;
        const live = duplicate ? undefined : liveTools.get(id);
        const result = duplicate ? undefined : results.get(id);
        const status = result ? result.status : live?.status ?? (partial ? 'waiting' : 'incomplete');
        const input = part.text;
        group.entries.push({kind:'tool',key:partKey,id,name:part.title ?? '未知工具',status,input,
          output:result ? result.parts.map(p=>p.text).join('\n') : live?.result == null ? '' : toolResultText(live.result),
          path:pathFrom(input),notice:duplicate ? '调用ID重复，未猜测结果归属。' : result?.error ?? null});
        used.add(id); group.live ||= partial || status === 'running';
      } else { text(partKey, view, [part]); }
    });
    if (view.error && !output.some(unit => unit.kind === 'message' && unit.key.startsWith(key) && unit.error)) {
      process(`${key}/error`,index).errors.push(view.error);
    }
    if (view.status === 'interrupted' && !view.error) process(`${key}/interrupted`,index).errors.push('这段消息已中断，未当作完成。');
    if (view.status === 'incomplete' && !view.error && !partial && !intermediate
      && !view.parts.some(part=>part.kind==='text')) process(`${key}/incomplete`,index).errors.push('回复未完整结束，请核对原生会话。');
  });
  // Event-only tools have no reliable position in the message stream. Preserve them with an explicit notice.
  for (const tool of projection.tools) {
    if (used.has(tool.id)) continue;
    const group = process(`${context}/unpositioned/${tool.id}`,projection.messages.length), input = argsText(tool.args);
    group.entries.push({kind:'tool',key:`${context}/tool/${tool.id}`,id:tool.id,name:tool.name,status:tool.status,
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
