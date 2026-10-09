import {useEffect,useState} from 'react';
import {useSelfEvolution} from '../use-self-evolution.ts';
import type {EvolutionController} from '../use-self-evolution.ts';
import type {EvolutionSnapshot} from '../self-evolution-types.ts';
const stamp='2026-10-09T02:00:00Z';
export function usePreviewEvolution(mode:string):EvolutionController{
  const base=useSelfEvolution(null);
  const [snapshot,setSnapshot]=useState<EvolutionSnapshot>({
    busy:mode==='pending',resources:[{id:'AGENTS.md',path:'C:/UI-Example/pi/agent/AGENTS.md',content:'',hash:null}],
    state:{revision:1,settings:{automatic:true,time:'03:00',budget:24000,model:null,allowed:['AGENTS.md']},runs:[],changes:[],
      candidates:mode==='empty'?[]:Array.from({length:48},(_,i)=>({
        id:String(i),title:i===0?'汇报先说结果':i===1?'先讲镜头目的，再选运镜':i===2?'以后称呼我为主人':`候选方法 ${i+1}`,
        kind:'新增规则',target:'AGENTS.md',before:'',after:(i===2?'与用户聊天时称呼用户为「主人」。':'汇报时先说明结果，技术细节在需要时再展开。')+(mode==='long'?' 这是一段用于检验换行与阅读区域的虚构长文本。'.repeat(35):''),
        baseHash:null,source:{path:'example-session.jsonl',session:'example-session',title:'工作方法反馈（UI 虚构）',message:`message-${i}`,ordinal:i+1,timestamp:stamp,quote:'以后汇报先说结果，技术细节需要时再展开。'},status:'pending',createdAt:stamp,revision:1
      }))
    }
  });
  useEffect(()=>{if(mode==='evolution-reverted'){setSnapshot(value=>({...value,state:{...value.state,candidates:value.state.candidates.map((c,i)=>i===0?{...c,status:'reverted'}:c),changes:[{id:'example-reverted',candidates:['0'],target:'AGENTS.md',before:'',after:'汇报时先说明结果，技术细节在需要时再展开。',status:'reverted',at:stamp}]}}));base.setTab('reverted');base.setActive('0');}},[mode,base.setTab,base.setActive]);
  return {...base,snapshot:mode==='loading'?null:snapshot,error:mode==='error'?'UI 示例：提取失败，草稿和上次进度保留。':base.error,active:base.active??'0',refresh:async()=>{},
    models:async()=>{if(mode==='evolution-model-error')throw new Error('UI 示例：获取模型选项 · 读取本机模型目录超时。');return[{provider:'example',id:'example',name:'UI 虚构模型'}];},
    source:async()=>({messages:[{role:'user',content:[{type:'text',text:'以后汇报先说结果，技术细节需要时再展开。'}]},{role:'assistant',content:[{type:'text',text:'好的。'}]}]}),openSource:async()=>base.setError('UI 示例：正式桌面版会在记事本打开会话原文件。'),
    extract:async(cancel)=>{setSnapshot(value=>({...value,busy:!cancel}));},
    mutate:async(action,fields={})=>{
      setSnapshot(value=>({...value,state:{...value.state,revision:value.state.revision+1,
        settings:action==='settings'?fields.settings as EvolutionSnapshot['state']['settings']:value.state.settings,
        candidates:value.state.candidates.map(c=>action==='approve'&&(fields.ids as string[]).includes(c.id)?{...c,status:'written'}:c.id!==fields.id?c:action==='edit'?{...c,after:String(fields.content)}:action==='dismiss'?{...c,status:'dismissed'}:action==='restore'?{...c,status:'pending'}:c)
      }}));return true;
    }
  };
}
