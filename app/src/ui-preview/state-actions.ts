import { useEffect, useState } from 'react';

export interface StateAction {selector:string;action?:'click'|'open'|'reveal'|'focus'|'collapse'|'create'|'menu'|'context';text?:string;skipWhenDialogOpen?:boolean;optional?:boolean}
const stage:StateAction={selector:'.project-stage-picker__trigger'};
const more:StateAction={selector:'[data-agent-more]'};
export const stateActions:Record<string,StateAction[]>={
  'operation-toast':[{selector:'[data-toast-demo]'}],
  'history-delete':[{selector:'[data-history-delete]'}],
  'history-clear':[{selector:'[data-history-clear]'}],
  'bookkeeping-validation':[{selector:'[data-create="bookkeeping"]'}],
  'bookkeeping-create':[{selector:'[data-create="bookkeeping"]'}],
  'bookkeeping-edit':[{selector:'[data-edit="bookkeeping"]'}],
  'bookkeeping-save-feedback':[{selector:'[data-edit="bookkeeping"]'}],
  'bookkeeping-refresh-fast':[{selector:'button[aria-label="刷新记账"]'}],
  'project-delete-confirm':[{selector:'[data-project-menu],[data-project-delete-document]'},{selector:'[data-slot="dropdown-menu-item"]',text:'删除项目',skipWhenDialogOpen:true}],

  'project-removed':[{selector:'[data-project-trash]',optional:true}],
  'project-restore-confirm':[{selector:'[data-project-trash]',optional:true},{selector:'[data-project-restore]'}],
  'project-create':[{selector:'[data-create="project"]'}],
  'todo-create':[{selector:'[data-create="todo"]'}],
  'todo-delete':[{selector:'[data-todo-id]',action:'context'},{selector:'[data-slot=context-menu-content] [role=menuitem]',text:'删除待办'}],
  'idea-create':[{selector:'[data-create="idea"]'}],
  'source-create':[{selector:'[data-create="source"]'}],
  'bookkeeping-fx':[{selector:'[data-create="bookkeeping"]',action:'create'}],
  'bookkeeping-fx-loading':[{selector:'[data-create="bookkeeping"]',action:'create'}],
  'bookkeeping-fx-error':[{selector:'[data-create="bookkeeping"]',action:'create'}],
  'bookkeeping-saving':[{selector:'[data-create="bookkeeping"]',action:'create'}],
  'month-open':[{selector:'.month-input-trigger'}],
  'shell-collapsed':[{selector:'.sidebar-trigger',action:'collapse'}],
  'agent-sidebar':[{selector:'[data-agent-entry]'}],
  'agent-sidebar-sessions':[{selector:'[data-agent-entry]'},{selector:'[data-agent-sessions]'}],
  'agent-sidebar-long':[{selector:'[data-agent-entry]'}],
  'agent-sidebar-running':[{selector:'[data-agent-entry]'}],
  'agent-sidebar-extension':[{selector:'[data-agent-entry]'}],
  'agent-sidebar-error':[{selector:'[data-agent-entry]'}],
  'agent-more':[more], 'agent-runtime':[more,{selector:'[data-slot=popover-content] button',text:'会话设置'},{selector:'.pi-session-settings .pi-runtime',action:'open'}],
  'agent-models':[{selector:'.pi-model-trigger'}], 'agent-sessions':[{selector:'[data-agent-sessions]',optional:true}],
  'agent-draft-review':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-decisions':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-create':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-update':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-long':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-conflict':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'}],
  'agent-draft-confirm':[{selector:'.agent-draft-card-trigger,.agent-draft-entry button'},{selector:'.agent-review-dialog .ui-form-dialog-footer button',text:'核对后应用'}],
  'agent-process-retry':[{selector:'.pi-process-toggle'}],
  'agent-bulk-delete':[{selector:'[data-agent-sessions]',optional:true},{selector:'[data-session-bulk]'},{selector:'.pi-session-management button',text:'全选筛选结果'},{selector:'.pi-session-management button',text:'删除'}],
  'agent-session-pinned':[{selector:'[data-agent-sessions]',optional:true}],
  'agent-session-manage':[{selector:'[data-agent-sessions]',optional:true},{selector:'[data-session-bulk]',action:'focus'}],
  'agent-session-pin-action':[{selector:'[data-agent-sessions]',optional:true},{selector:'[data-session-pin]',action:'focus'}],
  'agent-sessions-collapsed':[{selector:'[data-agent-sessions]',optional:true},{selector:'[data-session-group=pinned]',action:'collapse'},{selector:'[data-session-group=recent]',action:'collapse'}],
  'agent-process':[{selector:'.pi-process-toggle'}],
  'agent-delete':[{selector:'[data-agent-sessions]',optional:true},{selector:'[data-session-menu]',action:'menu'},{selector:'[data-slot=dropdown-menu-item]',text:'删除会话'}],
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
        if (step.skipWhenDialogOpen && document.querySelector('[role="dialog"]')) continue;
        if (step.action === 'create' && document.querySelector('[role="dialog"],.bookkeeping-editor')) continue;
        if (step.optional && !document.querySelector(step.selector)) continue;
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
        else if(step.action==='focus')node.focus();
        else if(step.action==='menu'){node.focus();node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));}
        else if(step.action==='context'){const box=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:box.left+20,clientY:box.top+10}));}
        else if(step.action!=='reveal')node.click();
        await new Promise<void>(resolve=>setTimeout(resolve,60));
      }
    }
    void open().catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:String(error));});
    return()=>{cancelled=true;};
  },[state]);
  return error;
}
