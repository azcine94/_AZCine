import { useEffect, useState } from 'react';

export interface StateAction {selector:string;action?:'click'|'open'|'reveal'|'collapse';text?:string}
const stage:StateAction={selector:'.project-stage-picker__trigger'};
const more:StateAction={selector:'.pi-chat-options',action:'open'};
export const stateActions:Record<string,StateAction[]>={
  'shell-collapsed':[{selector:'.sidebar-trigger',action:'collapse'}],
  'agent-more':[more], 'agent-runtime':[more,{selector:'.pi-options-panel .pi-runtime',action:'open'}],
  'agent-models':[{selector:'.pi-model-trigger'}], 'agent-sessions':[{selector:'.pi-sessions',action:'open'}],
  'agent-process':[{selector:'.pi-process-toggle'}],
  'provider-interface':[{selector:'.provider-models details',action:'open'}],
  'stage-select':[stage], 'stage-create':[stage,{selector:'.project-stage-picker__actions button',text:'新增标签'}],
  'stage-manage':[stage,{selector:'.project-stage-picker__actions button',text:'管理标签'}],
  'stage-rename':[stage,{selector:'.project-stage-picker__actions button',text:'管理标签'},{selector:'[data-stage-edit]'}],
  'stage-error':[stage,{selector:'.project-stage-picker__actions button',text:'新增标签'}],
  'calendar-open':[{selector:'.date-input__trigger'}],
  'table-menu':[{selector:'.table-menu__trigger'}],
  'table-stage-menu':[{selector:'button[aria-label="列操作：当前阶段"]'}],
  'table-date-menu':[{selector:'button[aria-label="列操作：当前交期"]'}],
  'table-delivered-menu':[{selector:'button[aria-label="列操作：已交完"]'}],
  'table-text-menu':[{selector:'button[aria-label="列操作：备注"]'}],
  'table-row-menu':[{selector:'tbody .table-menu__trigger'}],
  'add-menu':[{selector:'.project-add-menu > button'}],
  'discard-confirm':[{selector:'.text-action',text:'放弃此项目未保存编辑'}],
  'retry-confirm':[{selector:'.processing-record-retry'}],
  'tool-daily':[{selector:'.processing-tool-options button',text:'生成日报'}],
  'tool-analysis':[{selector:'.processing-tool-options button',text:'事件分析'}],
  'tool-skill':[{selector:'.processing-tool-options button',text:'处理 Skill'}],
  'original-source':[{selector:'.news-article button',text:'订阅原文'}],
  'conflict-details':[{selector:'.project-conflict details,.idea-version-conflict details',action:'open'}],
  'input-details':[{selector:'.processing-chosen details',action:'open'}],
  'response-details':[{selector:'.processing-evidence > details:nth-child(2)',action:'open'}],
  'popover-open':[{selector:'.catalog-components button',text:'打开浮层',action:'reveal'}],
  'dropdown-open':[{selector:'.catalog-components button',text:'操作菜单',action:'reveal'}],
  'tooltip-open':[{selector:'.catalog-components button',text:'悬停提示',action:'reveal'}],
};

// 预设仅在 ui.html 中执行，操作真实组件的打开入口，不给生产组件塞预览参数。
export function useStateActions(state:string) {
  const [error,setError]=useState('');
  useEffect(()=> {
    setError('');
    let cancelled=false;
    async function open() {
      if(state==='folds-open') {
        for(const node of document.querySelectorAll<HTMLDetailsElement>('details'))if(!node.open)node.querySelector<HTMLElement>('summary')?.click();
      }
      for(const step of stateActions[state]??[]) {
        let node:HTMLElement|undefined;
        for(let attempt=0;attempt<60&&!cancelled;attempt++) {
          node=Array.from(document.querySelectorAll<HTMLElement>(step.selector)).find(node=>!step.text||node.textContent?.includes(step.text));
          if(node&&node.getClientRects().length)break;
          await new Promise<void>(resolve=>setTimeout(resolve,30));
        }
        if(cancelled)return;
        if(!node||!node.getClientRects().length)throw new Error(`未找到预设入口：${step.text??step.selector}`);
        node.scrollIntoView({block:'center',inline:'nearest'});
        if(step.action==='open'&&node instanceof HTMLDetailsElement) {
          if(!node.open)node.querySelector<HTMLElement>('summary')?.click();
        } else if(step.action==='collapse') { if(node.getAttribute('aria-expanded')==='true')node.click(); }
        else if(step.action!=='reveal')node.click();
        await new Promise<void>(resolve=>setTimeout(resolve,60));
      }
    }
    void open().catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:String(error));});
    return()=>{cancelled=true;};
  },[state]);
  return error;
}
