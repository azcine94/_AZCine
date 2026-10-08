export interface DraftChange { field: string; before: string; after: string }
const labels: Record<string,string> = {name:'名称',title:'标题',body:'正文',tags:'标签',projectId:'关联公司',completed:'完成状态',date:'日期',purpose:'用途',amountFen:'金额（人民币分）',note:'备注',status:'报销状态',receiptIds:'票据',exchange:'汇率记录',feedUrl:'订阅地址',identity:'来源身份',domains:'覆盖领域',usage:'参与用途',intervalMinutes:'采集间隔（分钟）',enabled:'启用状态',labels:'阶段',blocks:'文档内容',items:'清单事项',text:'内容',checked:'勾选状态',included:'参与交付汇总',columns:'列',rows:'行',cells:'单元格',kind:'类型',width:'列宽',deleted:'删除状态',convertToTodo:'转为待办'};
const names: Record<string,string> = {unclaimed:'不报销',pending:'待提交',submitted:'已提交',paid:'已到账',official:'官方',research:'研究',media:'媒体',individual:'个人',frontiers:'AI 前沿',industry:'行业动态',visual:'影视 CG',editorial:'参与整理',watch:'关注线索',text:'文本',shot:'镜头号',stage:'阶段',delivered:'交完',list:'表格',checklist:'清单'};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hiddenFields=new Set(['id','revision','createdAt','updatedAt']);
function references(value:unknown,into:Record<string,string>={}) {
  if(Array.isArray(value))value.forEach(item=>references(item,into));
  else if(record(value)){if(typeof value.id==='string'&&typeof value.name==='string')into[value.id]=value.name;Object.values(value).forEach(item=>{if(typeof item==='object'&&item)references(item,into);});}
  return into;
}
function display(v:unknown,columnLabels:Record<string,string>={},valueKey=''):string {
  if(v===undefined)return '无';if(v===null||v==='')return '未填写';if(typeof v==='boolean')return v?'是':'否';
  if(Array.isArray(v))return v.length?v.map(value=>display(value,columnLabels,valueKey)).join('、'):'无';
  if(record(v))return Object.entries(v).filter(([key])=>!hiddenFields.has(key)).map(([key,value])=>`${columnLabels[key]??labels[key]??key}：${display(value,columnLabels,key)}`).join('\n');
  if(['status','identity','domains','usage','kind'].includes(valueKey))return names[String(v)]??String(v);
  if(['name','title','body','text','note','purpose','tags'].includes(valueKey))return String(v);
  return columnLabels[String(v)]??String(v);
}
export function draftChanges(before:unknown,after:unknown):DraftChange[] {
  const changes:DraftChange[]=[];
  const walk=(old:unknown,next:unknown,field:string,columnLabels:Record<string,string>={},valueKey='')=>{
    if(JSON.stringify(old)===JSON.stringify(next))return;
    if(Array.isArray(old)&&Array.isArray(next)&&[...old,...next].every(v=>record(v)&&typeof v.id==='string')){
      const left=new Map(old.map(v=>[v.id,v])),right=new Map(next.map(v=>[v.id,v]));
      for(const id of new Set([...left.keys(),...right.keys()])){const a=left.get(id),b=right.get(id),row=b??a;if(!row)continue;const title=String(row.title??row.name??row.text??`${next.indexOf(row)+1||old.indexOf(row)+1}`);walk(a,b,`${field} · ${title}`,columnLabels,valueKey);}
      if(old.length===next.length&&old.map(v=>v.id).join()!==next.map(v=>v.id).join())changes.push({field:`${field}顺序`,before:old.map(v=>String(v.title??v.name??v.text??v.id)).join(' → '),after:next.map(v=>String(v.title??v.name??v.text??v.id)).join(' → ')});
      return;
    }
    if(record(next)&&(record(old)||old==null&&!field)){
      const previous=record(old)?old:{};
      const columns={...columnLabels,...(Array.isArray(next.labels)?Object.fromEntries(next.labels.filter(record).map(c=>[String(c.id),String(c.name)])):{}),...(Array.isArray(next.columns)?Object.fromEntries(next.columns.filter(record).map(c=>[String(c.id),String(c.name)])):{})};
      const keys=field?[...new Set([...Object.keys(previous),...Object.keys(next)])]:Object.keys(next);
      for(const key of keys){if(hiddenFields.has(key))continue;walk(previous[key],next[key],field?`${field} / ${columns[key]??labels[key]??key}`:labels[key]??key,columns,key);}return;
    }
    changes.push({field:field||'内容',before:display(old,columnLabels,valueKey),after:display(next,columnLabels,valueKey)});
  };
  let original=before;
  if(record(before)&&record(after)&&record(before.config)&&!('config' in after))original=before.config;
  if(record(before)&&record(after)&&'receiptIds' in after&&Array.isArray(before.receipts))original={...before,receiptIds:before.receipts.filter(record).map(r=>r.id)};
  if(record(before)&&record(after)&&Object.keys(after).every(key=>['deleted','convertToTodo','completed','status'].includes(key)))original=Object.fromEntries(Object.keys(after).map(key=>[key,before[key]]));
  walk(original,after,'',references(after,references(before)));return changes;
}

interface ReviewColumn { id:string; name:string; kind:string; width?:unknown }
interface ReviewRow { id:string; cells:Record<string,unknown> }
interface ReviewTable { id:string; title:string; included:boolean; columns:ReviewColumn[]; rows:ReviewRow[] }
export interface DraftTableReview {
  id:string; title:string; mode:'added'|'removed'|'updated'; included:boolean;
  columns:(ReviewColumn & { previous?:ReviewColumn;change:'added'|'removed'|'unchanged' })[];
  rows:{id:string;index:number;mode:'added'|'removed'|'updated';cells:{before:string;after:string;changed:boolean}[]}[];
  beforeCount:number;afterCount:number;structureChanges:DraftChange[];
}
function tables(value:unknown):ReviewTable[] {
  if(!record(value)||!Array.isArray(value.blocks))return [];
  return value.blocks.filter(record).filter(block=>block.kind==='list'&&Array.isArray(block.columns)&&Array.isArray(block.rows)).map(block=>({
    id:String(block.id),title:String(block.title),included:block.included===true,
    columns:(block.columns as unknown[]).filter(record).map(c=>({id:String(c.id),name:String(c.name),kind:String(c.kind),...(c.width==null?{}:{width:c.width})})),
    rows:(block.rows as unknown[]).filter(record).map(row=>({id:String(row.id),cells:record(row.cells)?row.cells:{}})),
  }));
}
function cell(value:unknown,column:ReviewColumn,refs:Record<string,string>) {
  if(value==null||value==='')return '未填写';
  if(column.kind==='delivered')return value==='true'?'已交完':value==='false'?'未交完':String(value);
  // Arbitrary text cells stay literal (including strings like "pending").
  return column.kind==='stage'?refs[String(value)]??String(value):String(value);
}
export function draftTableReviews(before:unknown,after:unknown):DraftTableReview[] {
  if(!record(after)||!Array.isArray(after.blocks))return [];
  const left=new Map(tables(before).map(t=>[t.id,t])),right=new Map(tables(after).map(t=>[t.id,t]));
  const oldRefs=references(before),nextRefs=references(after),reviews:DraftTableReview[]=[];
  for(const id of new Set([...right.keys(),...left.keys()])){
    const a=left.get(id),b=right.get(id);if(JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(oldRefs)===JSON.stringify(nextRefs))continue;
    const oldColumns=new Map(a?.columns.map(c=>[c.id,c])??[]),nextColumns=new Map(b?.columns.map(c=>[c.id,c])??[]);
    const columns:DraftTableReview['columns']=[...(b?.columns??[]),...(a?.columns.filter(c=>!nextColumns.has(c.id))??[])].map(c=>({...c,previous:oldColumns.get(c.id),change:!oldColumns.has(c.id)?'added':!nextColumns.has(c.id)?'removed':'unchanged'}));
    const oldRows=new Map(a?.rows.map(r=>[r.id,r])??[]),nextRows=new Map(b?.rows.map(r=>[r.id,r])??[]);
    const oldPositions=new Map(a?.rows.map((r,index)=>[r.id,index+1])??[]);
    const ordered=[...(b?.rows??[]),...(a?.rows.filter(r=>!nextRows.has(r.id))??[])];
    const rows:DraftTableReview['rows']=[];
    ordered.forEach((row,index)=>{
      const old=oldRows.get(row.id),next=nextRows.get(row.id);
      const cells=columns.map(c=>{const previous=c.previous??c,original=cell(old?.cells[c.id],previous,oldRefs),proposed=cell(next?.cells[c.id],c,nextRefs);return {before:original,after:proposed,changed:(old?.cells[c.id]??'')!==(next?.cells[c.id]??'')||original!==proposed};});
      if(!old||!next||cells.some(c=>c.changed))rows.push({id:row.id,index:next?index+1:oldPositions.get(row.id)!,mode:!old?'added':!next?'removed':'updated',cells});
    });
    const structureChanges=draftChanges(a&&{title:a.title,included:a.included,columns:a.columns},b&&{title:b.title,included:b.included,columns:b.columns});
    const commonOld=a?.rows.filter(r=>nextRows.has(r.id)).map(r=>r.id)??[],commonNext=b?.rows.filter(r=>oldRows.has(r.id)).map(r=>r.id)??[];
    if(commonOld.join()!==commonNext.join())structureChanges.push({field:'行顺序',before:'原顺序',after:'已调整（单元格未变的行省略）'});
    if(!a||!b||rows.length||structureChanges.length)reviews.push({id,title:(b??a)!.title,mode:!a?'added':!b?'removed':'updated',included:(b??a)!.included,columns,rows,beforeCount:a?.rows.length??0,afterCount:b?.rows.length??0,structureChanges});
  }
  return reviews;
}
export function draftFieldsWithoutTables(value:unknown):unknown {
  if(!record(value)||!Array.isArray(value.blocks))return value;
  return {...value,blocks:value.blocks.filter(block=>!record(block)||block.kind!=='list')};
}
export const draftColumnKind=(kind:string)=>kind==='date'?'日期':names[kind]??kind;
