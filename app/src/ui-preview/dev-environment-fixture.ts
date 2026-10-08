import { useState } from 'react';
import { idleEnvironmentJob } from '../dev-environment-client.ts';
import type { EnvironmentJob, EnvironmentPaths, EnvironmentSnapshot } from '../dev-environment-client.ts';
import type { EnvironmentController } from '../use-dev-environment.ts';
import { notifyOperation } from '../components/ui/operation-toast.tsx';

export function usePreviewEnvironment(state:string):EnvironmentController {
  const example:EnvironmentPaths={herdr:'C:\\Example\\Herdr',openpi:'C:\\Example\\OpenPI-Sandbox',skills:'E:\\skills-manager'};
  if(state==='long')example.openpi='D:\\示例长路径\\'+('为换电脑准备的开发环境目录\\'.repeat(8))+'OpenPI-Sandbox';
  const [paths,setPaths]=useState<EnvironmentPaths>(state==='empty'?{herdr:'',openpi:'',skills:''}:example);
  const [output,setOutput]=useState('D:\\Example\\Exports');
  const [snapshot,setSnapshot]=useState<EnvironmentSnapshot|null>(state==='empty'?null:{paths:example,versions:{herdr:'示例版本',openpi:'示例版本',pi:'示例版本',node:'示例版本'},dependencies:{node:'C:\\Example\\Node',git:'C:\\Example\\Git',powershell:''},issues:state==='error'?['示例：找不到 Git/Bash，请补齐运行依赖。']:[],warnings:[],ready:state!=='error'});
  const [job,setJob]=useState<EnvironmentJob>({...idleEnvironmentJob,...(state==='environment-running'?{id:1,status:'running' as const,message:'正在打包开发环境（虚构）',done:730,total:2000}:state==='environment-cancelling'?{id:1,status:'cancelling' as const,message:'正在取消打包（虚构）'}:state==='environment-cancelled'?{id:1,status:'cancelled' as const,message:'已取消。未完成的示例输出保留。'}:state==='environment-failed'?{id:1,status:'failed' as const,message:'示例：磁盘空间不足。输入与原环境保留，未完成的文件不用于部署。'}:state==='environment-completed'?{id:1,status:'completed' as const,message:'两份示例文件',output:'D:\\Example\\Exports\\azcine-dev-example',files:['dev-environment.zip','skills-manager.zip']}: {})});
  const announce=async()=>{notifyOperation('UI 示例：不会读取目录、打包或部署。');};
  return {paths,output,snapshot,job,scanning:state==='loading'||state==='busy',choosing:false,error:'',connected:true,
    change:(key,value)=>setPaths(before=>({...before,[key]:value})),setOutput,
    browse:announce,inspect:async()=>{setSnapshot({paths,versions:{herdr:'示例版本',openpi:'示例版本',pi:'示例版本',node:'示例版本'},dependencies:{node:'示例',git:'示例',powershell:'示例'},issues:[],warnings:[],ready:true});await announce();},
    pack:async()=>{setJob({id:1,status:'running',message:'正在打包开发环境（虚构）',done:240,total:1000,output:null,files:[]});await announce();},
    cancel:async()=>{setJob({...idleEnvironmentJob,id:1,status:'cancelled',message:'已取消示例任务，没有生成文件。'});},open:announce};
}
