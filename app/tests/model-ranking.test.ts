import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRanking } from '../src/model-ranking-source.ts';
const revision='1'.repeat(40);
const records=(config:string)=>Array.from({length:50},(_,i)=>({model_name:`Fixture model ${config==='agent'||config==='text_to_image'?i:49-i}`,organization:'fixture',license:'MIT',rank:i+1,category:'overall',leaderboard_publish_date:'2026-10-02',score:i===0?-0.03:0.14,score_ci_lower:i===0?-0.05:0.12,score_ci_upper:i===0?-0.01:0.16,rating:1424-i,rating_lower:1420-i,rating_upper:1428-i,vote_count:1000+i}));
const response=(rows:unknown[],rev=revision,partial=false,total=rows.length,offset=0)=>new Response(JSON.stringify({rows:rows.map((row,i)=>({row_idx:i+offset,row,truncated_cells:[]})),num_rows_total:total,num_rows_per_page:100,partial}),{headers:{'x-revision':rev,'content-type':'application/json'}});
async function mock<T>(fetcher:typeof fetch,run:()=>Promise<T>){const original=globalThis.fetch;globalThis.fetch=fetcher;try{return await run()}finally{globalThis.fetch=original}}
const healthy:typeof fetch=async input=>response(records(new URL(String(input)).searchParams.get('config')!));
test('Given官方分项顺序不同 When自动获取 Then按模型对齐并保留负号原值区间',async()=>mock(healthy,async()=>{
 const s=await fetchRanking('agent',new AbortController().signal);assert.equal(s.rows.length,50);assert.equal(s.datasetRevision,revision);
 const a=s.rows[0];assert.equal(a.kind,'agent');if(a.kind!=='agent')throw Error('Wrong board');assert.deepEqual(a.netImprovement,{value:-3,lower:-5,upper:-1});assert.deepEqual(a.confirmedSuccess,{value:14.000000000000002,lower:12,upper:16});assert.equal(a.rankLow,null);
}));
test('Given文生图官方原分数 When自动获取 Then不转百分制且缺失字段不补造',async()=>mock(healthy,async()=>{
 const s=await fetchRanking('text-to-image',new AbortController().signal);const a=s.rows[0];assert.equal(a.kind,'text-to-image');if(a.kind!=='text-to-image')throw Error('Wrong board');assert.equal(a.score,1424);assert.equal(a.votes,1000);assert.equal(a.preliminary,null);assert.equal(a.rankHigh,null);
}));
test('Given不完整重复缺分项或混合版本 When自动获取 Then整体拒绝',async()=>{
 for(const mode of ['partial','duplicate','missing','revision','date'])await mock(async input=>{
  const config=new URL(String(input)).searchParams.get('config')!,r=records(config);
  if(mode==='duplicate')r[1].model_name=r[0].model_name;
  if(mode==='missing'&&config==='agent_steerability')r[0].model_name='unknown';
  if(mode==='date'&&config==='agent_steerability')r[0].leaderboard_publish_date='2026-10-01';
  return response(r,mode==='revision'&&config==='agent_steerability'?'2'.repeat(40):revision,mode==='partial');
 },()=>assert.rejects(fetchRanking('agent',new AbortController().signal)));
});
test('Given取数请求已取消或远端503 When获取 Then不返回成功快照',async()=>{
 const controller=new AbortController();controller.abort();await mock(healthy,()=>assert.rejects(fetchRanking('agent',controller.signal)));
 await mock(async()=>new Response('',{status:503}),()=>assert.rejects(fetchRanking('agent',new AbortController().signal),/503/));
});
test('Given文生图含其他分类与分页 When获取 Then只保留Overall并核对同一版本',async()=>{
 const rows=[...records('text_to_image'),...Array.from({length:70},(_,i)=>({...records('text_to_image')[i%50],category:'art'}))];
 await mock(async input=>{const offset=Number(new URL(String(input)).searchParams.get('offset'));return response(rows.slice(offset,offset+100),revision,false,120,offset)},async()=>{
  const s=await fetchRanking('text-to-image',new AbortController().signal);assert.equal(s.totalModels,50);assert.equal(s.rows.length,50);
 });
 await mock(async input=>{const offset=Number(new URL(String(input)).searchParams.get('offset'));return response(rows.slice(offset,offset+100),offset?'2'.repeat(40):revision,false,120,offset)},()=>assert.rejects(fetchRanking('text-to-image',new AbortController().signal)));
});
