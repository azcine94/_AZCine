import type { ProcessInfo } from '../process-monitor-panel.tsx';
export function processFixture(state:string):ProcessInfo[]{
  if(state==='empty'||state==='loading')return [];
  const now=Date.now();
  return ['Agent 会话','自进化提取','资讯整理','模型与资源读取'].map((source,index)=>({
    id:`fixture-${index}`,pid:4100+index,context:index===0?'示例会话 · 分镜规划':null,source:state==='long'?source+' · 虚构长任务名称用于检查换行'.repeat(4):source,
    status:['idle','running','waiting','failed'][index],startedAt:now-180000,endedAt:index===3?now-60000:null,lastActivityAt:now-5000,
    pending:index===1?1:0,activeProcesses:index===3?0:1,error:index===3?'示例：请求超时，进程已退出；输入保留。':null,
  }));
}
