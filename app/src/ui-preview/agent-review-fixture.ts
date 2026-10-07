import type { AgentDraft } from '../use-agent-data.ts';
import type { ProjectDocument } from '../projects-contract.ts';
import { at,uuid } from './data.ts';

// Explicit in-memory UI data. These scenes never submit an MCP operation.
export function reviewFixture(state:string):AgentDraft {
  const update=state==='agent-draft-update',long=state==='agent-draft-long';
  const columns:Extract<ProjectDocument['blocks'][number],{kind:'list'}>['columns']=[
    {id:uuid(301),name:'镜头号',kind:'shot'}, {id:uuid(302),name:'当前阶段',kind:'stage'},
    ...['制作','9.29 BCOPY','10.14 BCOPY+','10.20 FINAL','参考帧','说明'].map((name,index)=>({id:uuid(303+index),name,kind:'text' as const})),
  ];
  const original:ProjectDocument={id:uuid(300),name:'示例公司 · 镜头交付表（虚构资料）',revision:1,createdAt:at,
    labels:[{id:uuid(310),name:'制作中'},{id:uuid(311),name:'已核对'}],blocks:[
      {id:uuid(312),kind:'text',title:'项目说明',body:'这份数据只用于查看核对界面，不创建真实项目。'},
      {id:uuid(313),kind:'list',title:'镜头交付表',included:true,columns,
        rows:Array.from({length:long?85:5},(_,index)=>({id:uuid(400+index),cells:{
          [uuid(301)]:`SH_${String(index+1).padStart(4,'0')}`,[uuid(302)]:uuid(310),[uuid(303)]:'示例制作人员',
          [uuid(304)]:'9.29 BCOPY',[uuid(305)]:'10.14 BCOPY+',[uuid(306)]:'10.20 FINAL',
          [uuid(307)]:'用于查看长内容换行的虚构画面描述。'.repeat(long?12:1),[uuid(308)]:'截图原文保留，不推断年份。',
        }}))},
    ]};
  const proposed=structuredClone(original);
  if(update){const table=proposed.blocks[1];if(table.kind==='list'){
    table.rows[1].cells[uuid(302)]=uuid(311);table.rows[1].cells[uuid(308)]='本人要求更新的备注（虚构建议）';
    table.rows.push({id:uuid(499),cells:{[uuid(301)]:'SH_0006',[uuid(302)]:uuid(310),[uuid(308)]:'新增一行（虚构建议）'}});
  }}
  return {id:'ui-fixture-draft',conversationKey:'default',inputId:'ui-fixture-input',messageKey:'mcp:ui-preview:ui-fixture-input:demo',
    payload:{version:1,operations:[],decisions:state==='agent-draft-confirm'?[]:['参考帧为文字描述，未嵌入图片（虚构待确认事项）。']},context:{messageCount:0,objects:[]},
    validation:{error:state==='agent-draft-conflict'?'示例原记录已变化；旧草案与输入保留，请重新读取版本。':null,items:[{
      title:original.name,objectId:original.id,action:update?'patchTables':'create',actionLabel:update?'修改镜头表':'新建公司项目',before:update?original:null,after:proposed,
    }]},status:state==='agent-draft-conflict'?'conflict':'review',receipt:null,revision:1,createdAt:at};
}
