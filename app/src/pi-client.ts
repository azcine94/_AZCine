import { invoke, isTauri } from '@tauri-apps/api/core';
import { parsePiModels, parsePiState } from './pi-contract.ts';
import type { PiModel, PiState, PromptDisposition } from './pi-contract.ts';
export interface PiImage { id: string; name: string; data: string; mimeType: string }
export interface PiProjection { messages: unknown[]; partial: unknown | null; tools: PiTool[]; steering: string[]; followUp: string[]; activity: string; outcome: string; notice: string | null }
export interface PiTool { id: string; name: string; status: string; args?: unknown; result?: unknown }
export interface PiSnapshot { generation: number; seq: number; connection: 'disconnected'|'connecting'|'ready'|'error'; busy: boolean; stopping: boolean; sending: boolean; state: PiState|null; models: PiModel[]; projection: PiProjection; recoveredQueue: string[]; error: { code: string; message: string }|null; notice: string|null; cwd: string|null; runtime: { piVersion:string; nodeVersion:string; root:string }|null; paths: {agent:string;sessions:string;defaultCwd:string}|null }
export interface PiSession { id:string; path:string; name:string|null; cwd:string; updatedAt:string; messageCount:number }
export interface ModelInput { provider:string;baseUrl:string;api:string;modelId:string;name:string;contextWindow:number;maxTokens:number;reasoning:boolean;supportsImages:boolean;apiKey:string|null }
export interface SendReceipt {generation:number;sessionId:string;disposition:PromptDisposition}
const invalid=()=>new Error('Pi 状态格式无效，未当作成功；请重新读取，输入仍保留。');
const record=(v:unknown):Record<string,unknown>=>{if(typeof v!=='object'||v===null||Array.isArray(v))throw invalid();return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string')throw invalid();return v;};
const optional=(v:unknown):string|null=>v===null||v===undefined?null:text(v);
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw invalid();return v;};
const integer=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw invalid();return v;};
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw invalid();return v;};
const strings=(v:unknown):string[]=>list(v).map(text);
export function parseSnapshot(value:unknown):PiSnapshot {
  const v=record(value),p=record(v.projection);const connection=text(v.connection);if(!['disconnected','connecting','ready','error'].includes(connection))throw invalid();
  const runtime=v.runtime==null?null:record(v.runtime),paths=v.paths==null?null:record(v.paths),error=v.error==null?null:record(v.error);
  const tools=list(p.tools).map(t=>{const v=record(t);return {id:text(v.id),name:text(v.name),status:text(v.status),args:v.args,result:v.result};});
  return {generation:integer(v.generation),seq:integer(v.seq),connection:connection as PiSnapshot['connection'],busy:flag(v.busy),stopping:flag(v.stopping),sending:flag(v.sending),state:v.state===null?null:parsePiState(v.state),models:parsePiModels({models:v.models}),projection:{messages:list(p.messages),partial:p.partial??null,tools,steering:strings(p.steering),followUp:strings(p.followUp),activity:text(p.activity),outcome:text(p.outcome),notice:optional(p.notice)},recoveredQueue:strings(v.recoveredQueue),error:error?{code:text(error.code),message:text(error.message)}:null,notice:optional(v.notice),cwd:optional(v.cwd),runtime:runtime?{piVersion:text(runtime.piVersion),nodeVersion:text(runtime.nodeVersion),root:text(runtime.root)}:null,paths:paths?{agent:text(paths.agent),sessions:text(paths.sessions),defaultCwd:text(paths.defaultCwd)}:null};
}
export function parseSessions(value:unknown):{sessions:PiSession[];unreadable:number}{const v=record(value);return{unreadable:integer(v.unreadable),sessions:list(v.sessions).map(s=>{const v=record(s);return{id:text(v.id),path:text(v.path),name:optional(v.name),cwd:text(v.cwd),updatedAt:text(v.updatedAt),messageCount:integer(v.messageCount)};})};}
export function piError(value:unknown):string {if(value instanceof Error)return value.message; if(typeof value==='object'&&value!==null&&'message'in value&&typeof value.message==='string')return value.message;return 'Pi 操作未完成，请核对连接；输入与附件仍保留。';}
export const desktopPi=()=>isTauri();
export async function callPi<T=unknown>(command:string,args?:Record<string,unknown>):Promise<T>{if(!desktopPi())throw new Error('网页预览不能连接 Pi，请运行 npm run dev 打开桌面开发版。');return invoke<T>(command,args);}
