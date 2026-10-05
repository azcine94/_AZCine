import { validDate } from './workspace-contract.ts';
export interface NewsRange { period:'latest'|'day'|'week'|'custom'|'all'; start:string|null; end:string|null; includeUndated:boolean }
export interface FrozenNewsScope {start:string|null;end:string;sourceId:string|null;query:string;includeUndated:boolean;batchId:string|null}
export const initialNewsRange=(period:NewsRange['period']):NewsRange=>({period,start:null,end:null,includeUndated:false});
export function newsRangeRequest(range:NewsRange){
  if(range.period!=='custom')return {...range,start:null,end:null};
  if(!range.start||!range.end||!validDate(range.start)||!validDate(range.end)||range.start>range.end)throw new Error('请选择有效的开始和结束日期。');
  // Publication windows consistently use Beijing dates, including the entire final day.
  return {...range,start:new Date(range.start+'T00:00:00+08:00').toISOString(),end:new Date(range.end+'T23:59:59.999+08:00').toISOString()};
}
export function parseNewsScope(value:unknown):FrozenNewsScope{
  if(!value||typeof value!=='object')throw new Error('资料范围未读取完整，请刷新。');
  const v=value as Record<string,unknown>;
  if(typeof v.end!=='string'||!Number.isFinite(Date.parse(v.end))||typeof v.query!=='string'||typeof v.includeUndated!=='boolean'||[v.start,v.sourceId,v.batchId].some(s=>s!==null&&typeof s!=='string'))throw new Error('资料范围未读取完整，请刷新。');
  return v as unknown as FrozenNewsScope;
}
