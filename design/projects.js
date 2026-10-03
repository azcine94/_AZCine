/* 文档式个人项目原型。只有本次页面内存，不上传资料、不调用模型、不持久保存。 */
window.createAzProjects = function (api) {
  'use strict';
  const {D,state,esc,icon,nav,refresh,toast}=api;
  const $ = selector => document.querySelector(selector);
  let serial=100, query='', panel='', activeProject='';
  const uid=prefix=>prefix+(++serial);
  const roles=[['subject','镜头 / 事项','text'],['stage','阶段','stage'],['date','交付日期','date'],['status','状态','status']];
  const statuses=['未提交','制作中','已提交'];
  const columns=()=>roles.map(([role,name,type])=>({id:role,role,name,type}));
  const deliveryRow=(id,subject,stage,date,status,note)=>({id,cells:{subject,stage,date,status,note}});
  const projects=[{
    id:'film',group:'company',name:'雾港 · 片头',description:'公司项目文档 · 虚构示例',
    tags:[{id:'acopy',name:'ACOPY'},{id:'bcopy',name:'BCOPY'},{id:'final',name:'FINAL'}],
    blocks:[
      {id:'intro',type:'text',title:'项目说明',text:'片头镜头的工作记录放在这里。交付安排在下方清单，参考资料与修改意见可以继续往文档里添加。'},
      {id:'deliveries',type:'table',title:'镜头交付清单',summarize:true,columns:[...columns(),{id:'note',name:'备注',type:'text'}],rows:[
        deliveryRow('d0','FG_021','acopy','2026-09-29','已提交','构图预览'),
        deliveryRow('d2','FG_021','bcopy','2026-10-14','制作中','灯光合成预览'),
        deliveryRow('d3','FG_024','bcopy','2026-10-14','未提交','材质灯光预览'),
        deliveryRow('d4','FG_021','final','2026-10-20','未提交','最终序列')
      ]},
      {id:'references',type:'text',title:'参考资料',text:'在这里粘贴资料说明、原始链接或工作笔记。自由文字不会自动变成交付日期。'}
    ],sourceDraft:{name:'',text:'',fileName:''},pending:null,reviewed:false
  }];
  const createDraft={name:'',description:''};
  const formDrafts=new Map(),titleDrafts=new Map();
  const get=id=>projects.find(p=>p.id===id);
  const current=()=>get(activeProject);
  const block=(p,id)=>p?.blocks.find(b=>b.id===id);
  const link=(route,label,cls='pill')=>`<a class="${cls}" href="#${route}" data-route="${route}">${label}</a>`;
  const button=(label,attrs='',cls='doc-button')=>`<button type="button" class="${cls}" ${attrs}>${label}</button>`;
  const projectRoute=p=>`projects/${p.id}`;
  const date=value=>!value?'待定':value.slice(0,4)===D.now.slice(0,4)?value.slice(5).replace('-','/'):value;
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const roleColumn=(b,role)=>b.columns.find(c=>c.role===role);
  const value=(b,r,role)=>r.cells[roleColumn(b,role)?.id]||'';
  const stageName=(p,id)=>p.tags.find(t=>t.id===id)?.name||'';
  function collect(p) {
    const ready=[],incomplete=[];
    for(const b of p.blocks.filter(b=>b.type==='table'&&b.summarize))for(const r of b.rows){
      if(value(b,r,'status')==='已提交')continue;
      const subject=value(b,r,'subject').trim(),stage=stageName(p,value(b,r,'stage')),due=value(b,r,'date'),status=value(b,r,'status');
      const entry={id:r.id,blockId:b.id,subject,stage,date:due,status};
      const missing=[];
      if(!subject)missing.push('事项');if(!stage)missing.push('阶段');if(!validDate(due))missing.push('完整日期');if(!statuses.includes(status))missing.push('状态');
      if(missing.length)incomplete.push({...entry,missing});else ready.push(entry);
    }
    ready.sort((a,b)=>a.date.localeCompare(b.date));
    return {ready,incomplete};
  }
  function locate(id){for(const p of projects)for(const b of p.blocks.filter(b=>b.type==='table')){const r=b.rows.find(r=>r.id===id);if(r)return {p,b,r};}return null;}
  function sync(){
    D.deliveries=projects.flatMap(p=>collect(p).ready.map(r=>({id:r.id,projectId:p.id,project:p.name,name:r.subject,node:r.stage,date:r.date,status:r.status}))).sort((a,b)=>a.date.localeCompare(b.date));
    state.reviewed=get('film').reviewed;
  }
  function summaryHTML(p){
    const {ready,incomplete}=collect(p),groups=[];
    for(const row of ready){let g=groups.find(g=>g.date===row.date&&g.stage===row.stage);if(!g){g={date:row.date,stage:row.stage,rows:[]};groups.push(g);}g.rows.push(row);}
    const groupHTML=g=>`<div class="doc-summary-line"><time class="num">${date(g.date)}</time><span class="doc-stage">${esc(g.stage)}</span><div>${g.rows.map(r=>button(esc(r.subject),`data-doc-jump="${r.id}"`,'summary-record')).join('')}</div></div>`;
    const next=ready[0],nextRows=ready.filter(r=>r.date===next?.date);
    return `<div class="doc-summary-layout"><div class="doc-next-delivery"><span class="doc-summary-eyebrow">${next?'最近待交':'交付摘要'}</span>${next?`<time class="doc-summary-date num">${date(next.date)}</time><p>${nextRows.length} 项交付 · ${[...new Set(nextRows.map(r=>r.stage))].map(esc).join(' / ')}</p>`:'<h3>还没有交付安排</h3>'}<span class="meta">由参与汇总的清单整理</span></div><div class="doc-summary-groups"><div class="doc-summary-head"><h3>交付摘要</h3><span>${ready.length} 项待交 · 点镜头定位原行</span></div>${groups.length?groups.slice(0,3).map(groupHTML).join(''):'<p class="doc-summary-empty">在清单填写完整日期、阶段和状态后显示。</p>'}${groups.length>3?`<details class="doc-summary-more"><summary>其余 ${groups.length-3} 组交付</summary>${groups.slice(3).map(groupHTML).join('')}</details>`:''}</div></div>${incomplete.length?`<details class="doc-missing"><summary>${incomplete.length} 条待补信息，尚未计入日期摘要</summary>${incomplete.map(r=>button(`${esc(r.subject||'未命名记录')} · 缺${r.missing.join(' / ')}`,`data-doc-jump="${r.id}"`,'missing-record')).join('')}</details>`:''}`;
  }
  function changed(){sync();const p=current();if(p&&$('#doc-summary'))$('#doc-summary').innerHTML=summaryHTML(p);if($('#doc-memory'))$('#doc-memory').textContent='已更新 · 仅本次演示';}
  function cards(){const visible=projects.filter(p=>(p.name+' '+p.description).toLowerCase().includes(query.toLowerCase().trim()));return visible.length?visible.map(p=>{const {ready,incomplete}=collect(p),n=ready[0],same=ready.filter(r=>r.date===n?.date);return `<article class="document-project-card"><div class="doc-card-identity"><div class="doc-card-top"><span>${icon('projects')}公司项目</span><span class="meta">${p.blocks.length} 个内容块</span></div><h2>${link(projectRoute(p),esc(p.name),'doc-card-title')}</h2><p>${esc(p.description||'按你的需要组织项目文档')}</p></div><div class="doc-card-bottom"><div class="doc-card-summary"><span class="meta">${n?'最近交付':'交付安排'}</span>${n?`<time class="num">${date(n.date)}</time><span>${same.length} 项待交 · ${[...new Set(same.map(r=>r.stage))].map(esc).join(' / ')}</span>`:`<span>${incomplete.length?'有待补信息的交付记录':'还没有交付安排'}</span>`}</div><footer>${link(projectRoute(p),'打开文档 '+icon('arrow'),'section-action')}</footer></div></article>`;}).join(''):`<div class="doc-empty"><p>${query?'没有找到公司项目。':'还没有公司项目，从一份文档开始。'}</p>${button('清除搜索','data-doc-clear-search')}</div>`;}
  function index(){return `<div class="document-project-index"><div class="doc-index-toolbar"><p class="subtle">文档与交付，按项目组织</p><label class="doc-search"><span class="sr-label">搜索公司项目</span><input id="doc-project-search" class="input" value="${esc(query)}" placeholder="搜索公司项目"></label>${link('projects/new',icon('plus')+'新建公司项目','pill on')}</div><section class="project-company-module" aria-labelledby="company-projects-title"><header class="project-module-heading"><h2 id="company-projects-title">公司项目</h2><span class="meta">自由文档 · 清单 · 交付</span></header><div class="document-project-grid" id="doc-project-grid">${cards()}</div></section><section class="project-personal-module" aria-labelledby="personal-projects-title"><header class="project-module-heading"><h2 id="personal-projects-title">个人项目</h2><span class="meta">待定</span></header><div class="personal-project-placeholder"><span class="personal-project-icon">${icon('agent')}</span><div><h3>给自己的项目，留一个位置</h3><p>这个模块暂不设计内部功能。</p></div><span class="personal-project-state">待定</span></div></section></div>`;}
  function createPage(){return `<section class="doc-form-page">${link('projects','← 全部项目','section-action')}<h2>新建公司项目文档</h2><form id="doc-create-form"><label for="doc-project-name">项目名称</label><input id="doc-project-name" class="input" value="${esc(createDraft.name)}" maxlength="80" required><label for="doc-project-description">简短说明（可选）</label><textarea id="doc-project-description" class="textarea" maxlength="300">${esc(createDraft.description)}</textarea><p id="doc-create-error" class="err" role="alert"></p><div class="foot"><span class="meta">公司项目 · 不预设内容或清单</span><button type="submit" class="pill on">创建项目</button></div></form></section>`;}
  function field(p,b,r,c){
    const attrs=`data-doc-cell="${c.id}" data-row="${r.id}" aria-label="${esc(c.name)}"`,v=r.cells[c.id]||'';
    if(c.type==='stage')return `<select ${attrs}><option value="">选择阶段</option>${p.tags.map(t=>`<option value="${t.id}" ${t.id===v?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`;
    if(c.type==='status')return `<select ${attrs}><option value="">选择状态</option>${statuses.map(s=>`<option ${s===v?'selected':''}>${s}</option>`).join('')}</select>`;
    return `<input ${attrs} type="${c.type==='date'?'date':'text'}" value="${esc(v)}" maxlength="300" placeholder="${c.type==='date'?'':'—'}">`;
  }
  function table(p,b){return `<div class="doc-list-toolbar"><span class="doc-list-label">表格清单 · ${b.rows.length} 条</span><label class="doc-summary-toggle"><input type="checkbox" data-doc-summary-toggle ${b.summarize?'checked':''}>计入交付汇总</label>${button('管理列',`data-doc-panel="columns:${b.id}"`)}</div><div class="doc-table-scroll" tabindex="0" aria-label="${esc(b.title)}，可横向滚动"><table class="doc-table"><colgroup>${b.columns.map(c=>`<col class="doc-col-${c.type}">`).join('')}<col class="doc-col-action"></colgroup><thead><tr>${b.columns.map(c=>`<th scope="col">${esc(c.name)}</th>`).join('')}<th scope="col"><span class="sr-label">行操作</span></th></tr></thead><tbody>${b.rows.map(r=>`<tr id="doc-row-${r.id}" data-doc-row="${r.id}">${b.columns.map(c=>`<td>${field(p,b,r,c)}</td>`).join('')}<td>${button('移除',`data-doc-remove-row="${r.id}" aria-label="移除此行"`,'doc-row-action')}</td></tr>`).join('')}</tbody></table></div>${!b.rows.length?'<p class="meta doc-list-empty">还没有记录，添加第一行。</p>':''}<div class="doc-list-footer">${button('+ 添加一行',`data-doc-add-row="${b.id}"`)}<span class="doc-block-error err" role="alert"></span></div>`;}
  function contentBlock(p,b,n){return `<section class="document-block" data-block="${b.id}" id="doc-block-${b.id}"><header class="document-block-header"><input class="doc-block-title" value="${esc(b.title)}" aria-label="内容块标题" data-doc-block-title maxlength="80"><div class="doc-block-actions">${button('↑',`data-doc-move="${b.id}" data-step="-1" aria-label="上移内容块" ${n===0?'disabled':''}`)}${button('↓',`data-doc-move="${b.id}" data-step="1" aria-label="下移内容块" ${n===p.blocks.length-1?'disabled':''}`)}${button('移除',`data-doc-remove-block="${b.id}"`)}</div></header>${b.type==='text'?`<textarea class="doc-text" data-doc-text aria-label="${esc(b.title)}正文" maxlength="8000" rows="${Math.max(2,Math.min(8,b.text.split('\n').length+1))}" placeholder="开始写下内容…">${esc(b.text)}</textarea>`:b.type==='table'?table(p,b):`<div class="doc-checklist">${b.items.map(item=>`<div class="doc-check-item"><label><input type="checkbox" data-doc-check="${item.id}" aria-label="完成此项" ${item.done?'checked':''}></label><input type="text" data-doc-check-text="${item.id}" value="${esc(item.text)}" aria-label="清单项内容" maxlength="300">${button('移除',`data-doc-remove-check="${item.id}"`)}</div>`).join('')}${button('+ 添加清单项',`data-doc-add-check="${b.id}"`)}</div>`}</section>`;}
  function panelHTML(p){
    if(!panel)return '';
    const key=p.id+':'+panel;if(!formDrafts.has(key))formDrafts.set(key,{title:'',type:'text',name:'',tagId:''});const d=formDrafts.get(key);
    const close=button('收起','data-doc-close-panel','section-action');
    if(panel==='add')return `<section class="doc-panel"><header><h3>添加内容</h3>${close}</header><form id="doc-add-block-form">${select('doc-block-kind','内容类型',[['text','文字段落'],['table','表格 list'],['checklist','勾选清单']],d.type)}<label for="doc-new-block-title">标题</label><input id="doc-new-block-title" class="input" value="${esc(d.title)}" placeholder="例如：镜头交付、工作笔记、参考资料" maxlength="80" required><p class="meta">新表格默认不参与交付汇总，你可以自行启用。</p><p class="err" data-doc-form-error role="alert"></p><div class="foot"><button class="pill on" type="submit">添加到文档</button></div></form></section>`;
    if(panel==='tags')return `<section class="doc-panel"><header><div><h3>项目阶段标签</h3><p class="meta">只影响本项目，阶段不等于完成状态。</p></div>${close}</header><div class="doc-tags">${p.tags.map(t=>`<form class="doc-tag-form" data-tag="${t.id}"><input class="input" aria-label="阶段名称" maxlength="40" value="${esc(formDrafts.get(p.id+':tag:'+t.id)??t.name)}"><button class="pill" type="submit">改名</button><span class="err" role="alert"></span></form>`).join('')}</div><form id="doc-add-tag-form"><label for="doc-tag-name">新增阶段</label><div class="doc-inline-form"><input id="doc-tag-name" class="input" maxlength="40" value="${esc(d.name)}" placeholder="例如：BCOPY+、测试版" required><button class="pill on" type="submit">添加标签</button></div><p class="err" data-doc-form-error role="alert"></p></form></section>`;
    if(panel.startsWith('columns:')){const b=block(p,panel.split(':')[1]);if(!b)return '';return `<section class="doc-panel" data-columns-for="${b.id}"><header><div><h3>${esc(b.title)} · 管理列</h3><p class="meta">列名可改。${b.summarize?'正在汇总，事项 / 阶段 / 日期 / 状态四类列需保留。':'自定义表格，按需调整列。'}</p></div>${close}</header>${b.columns.map(c=>`<form class="doc-column-form" data-column="${c.id}" data-block="${b.id}"><input class="input" aria-label="列名称" maxlength="40" value="${esc(formDrafts.get(p.id+':col:'+b.id+':'+c.id)??c.name)}"><span class="meta">${c.role?'汇总字段':'自定义'}</span><button class="pill" type="submit">改名</button>${button('移除列',`data-doc-remove-column="${c.id}" data-block="${b.id}" ${b.summarize&&c.role?'disabled':''}`,'pill')}<span class="err" role="alert"></span></form>`).join('')}<form id="doc-add-column-form" data-block="${b.id}"><label for="doc-column-name">新增文字列</label><div class="doc-inline-form"><input id="doc-column-name" class="input" maxlength="40" value="${esc(d.name)}" placeholder="例如：文件位置、备注" required><button class="pill on" type="submit">添加列</button></div><p class="err" data-doc-form-error role="alert"></p></form></section>`;}
    return '';
  }
  function select(id,label,options,selected){return `<label for="${id}">${label}</label><select id="${id}" class="select">${options.map(([v,t])=>`<option value="${v}" ${v===selected?'selected':''}>${t}</option>`).join('')}</select>`;}
  function docPage(p){return `<article class="project-document"><div class="doc-breadcrumb">${link('projects','← 全部项目','section-action')}<span id="doc-memory" class="meta">仅本次演示 · 刷新还原</span></div><header class="doc-heading"><input class="doc-title" data-doc-project-title value="${esc(titleDrafts.get(p.id)?.value??p.name)}" aria-label="项目文档标题" maxlength="80"><div class="doc-heading-actions">${button('阶段标签','data-doc-panel="tags"')}${link(projectRoute(p)+'/import','导入资料','doc-button')}${button(icon('plus')+'添加内容','data-doc-panel="add"','pill on')}</div></header><p class="err" id="doc-title-error" role="alert">${esc(titleDrafts.get(p.id)?.error||'')}</p><section class="doc-summary" id="doc-summary" aria-label="项目交付摘要">${summaryHTML(p)}</section>${panelHTML(p)}<div class="doc-blocks">${p.blocks.length?p.blocks.map((b,n)=>contentBlock(p,b,n)).join(''):`<div class="doc-empty"><h3>从一段文字或一份清单开始</h3><p>没有预设业务，你来决定项目里放什么。</p>${button('添加内容','data-doc-panel="add"','pill on')}</div>`}</div><div class="doc-add-bottom">${button('+ 添加内容块','data-doc-panel="add"')}</div></article>`;}
  function targetSnapshot(p){return JSON.stringify(['d2','d3'].map(id=>{const found=locate(id);return found&&found.p===p?{block:found.b.id,summarize:found.b.summarize,columns:found.b.columns,row:found.r,tags:p.tags}:null;}));}
  function makeProposal(p){return {baseline:targetSnapshot(p),choice:'',date:'',error:'',applied:false};}
  function proposalLabel(p,id){const snapshot=JSON.parse(p.pending.baseline),entry=snapshot[['d2','d3'].indexOf(id)];if(!entry)return '原记录不存在';const v=role=>entry.row.cells[entry.columns.find(c=>c.role===role)?.id]||'';return `${v('subject')} · ${entry.tags.find(t=>t.id===v('stage'))?.name||'阶段待补充'}`;}
  function importPage(p,pending=false){
    if(pending&&p.id==='film'&&!p.pending)p.pending=makeProposal(p);
    const draft=p.sourceDraft,proposal=pending?p.pending:null;
    return `<section class="doc-form-page">${link(projectRoute(p),'← '+esc(p.name),'section-action')}<h2>${pending?'核对交期变更':'导入项目资料'}</h2>${pending?proposal?.applied?`<div class="doc-import-result"><h3>已更新文档中的两条交付记录</h3><p>其他行不变，来源记录已附到文档末尾。</p>${link(projectRoute(p),'返回项目文档','pill on')}</div>`:proposal?`<p class="subtle">固定示例 · 来源草稿与正式文档尚未修改。</p><form id="doc-apply-import"><div class="doc-diff"><h3>${esc(proposalLabel(p,'d2'))}</h3><p>示例交付表：2026-10-16；示例截图：2026-10-17。</p>${select('doc-import-choice','采用哪个日期？',[['','请选择'],['2026-10-16','2026-10-16 · 交付表'],['2026-10-17','2026-10-17 · 截图']],proposal.choice)}</div><div class="doc-diff"><h3>${esc(proposalLabel(p,'d3'))}</h3><p>示例截图写“10/18”，缺少年份。</p><label for="doc-import-date">确认完整日期</label><input class="input" id="doc-import-date" type="date" value="${esc(proposal.date)}" required></div><p class="err" data-doc-form-error role="alert">${esc(proposal.error)}</p><div class="foot">${button('重新核对','data-doc-recheck-import','pill')}${link(projectRoute(p)+'/import','返回我的资料','pill')}<button id="doc-import-apply" class="pill on" type="submit" ${!proposal.choice||!validDate(proposal.date)?'disabled':''}>确认更新文档</button></div></form>`:'<p>没有待核对的示例变更。</p>':`<form id="doc-source-form"><label for="doc-source-name">资料名称</label><input class="input" id="doc-source-name" maxlength="120" value="${esc(draft.name)}" placeholder="例如：交付要求"><label for="doc-source-text">原始文字 / 链接</label><textarea id="doc-source-text" class="textarea" rows="7" maxlength="8000">${esc(draft.text)}</textarea><label class="doc-file-label">选择文档 / 截图<input id="doc-source-file" type="file" aria-label="选择资料文件"></label><p class="meta" id="doc-file-name">${esc(draft.fileName||'文件只记录名称，不读取、不上传')}</p><p class="meta">可将文字原样加入文档。未接入 AI / Excel 解析，不会从任意输入编造交付记录。</p><p class="err" data-doc-form-error role="alert"></p><div class="foot">${p.id==='film'&&!p.reviewed?link(projectRoute(p)+'/import/pending','查看固定核对示例','pill'):''}<button class="pill on" type="submit">原样加入文档</button></div></form>`}</section>`;
  }
  function render(path=''){
    if(!path){activeProject='';return index();}if(path==='new'){activeProject='';return createPage();}
    if(path==='personal'){activeProject='';panel='';return `<section class="doc-form-page">${link('projects','← 全部项目','section-action')}<div class="doc-empty"><h2>个人项目 · 待定</h2><p>本轮不预设个人项目的内部结构或功能。</p></div></section>`;}
    const parts=path.split('/'),p=get(parts[0]);if(!p)return `<div class="doc-empty"><h3>项目文档不存在</h3>${link('projects','返回项目')}</div>`;
    if(activeProject!==p.id){panel='';activeProject=p.id;}
    if(parts[1]==='import')return importPage(p,parts[2]==='pending');
    return docPage(p);
  }
  function rerender(focusSelector){refresh();if(focusSelector)$(focusSelector)?.focus({preventScroll:true});}
  function jump(id){const row=$('#doc-row-'+id);if(row){row.scrollIntoView({block:'center',behavior:'auto'});row.querySelector('input,select')?.focus({preventScroll:true});row.classList.add('doc-row-highlight');setTimeout(()=>row.classList.remove('doc-row-highlight'),1200);}}
  function handleInput(e){
    if(e.id==='doc-project-search'){query=e.value;$('#doc-project-grid').innerHTML=cards();return;}
    if(e.id==='doc-project-name')createDraft.name=e.value;
    if(e.id==='doc-project-description')createDraft.description=e.value;
    const p=current();if(!p)return;
    if(e.matches('[data-doc-project-title]')){const name=e.value.trim();if(!name||projects.some(x=>x!==p&&x.name.toLowerCase()===name.toLowerCase())){const error='名称不能为空，也不能与其他项目相同。';titleDrafts.set(p.id,{value:e.value,error});$('#doc-title-error').textContent=error;return;}titleDrafts.delete(p.id);p.name=name;$('#doc-title-error').textContent='';changed();}
    const section=e.closest('[data-block]'),b=block(p,section?.dataset.block);
    if(e.hasAttribute('data-doc-block-title')&&b){b.title=e.value;changed();}
    if(e.hasAttribute('data-doc-text')&&b){b.text=e.value;changed();}
    if(e.dataset.docCell&&b){const r=b.rows.find(r=>r.id===e.dataset.row);if(r){r.cells[e.dataset.docCell]=e.value;changed();}}
    if(e.dataset.docCheckText&&b){const item=b.items.find(i=>i.id===e.dataset.docCheckText);if(item)item.text=e.value;changed();}
    if(e.dataset.docCheck&&b){const item=b.items.find(i=>i.id===e.dataset.docCheck);if(item)item.done=e.checked;changed();}
    if(e.hasAttribute('data-doc-summary-toggle')&&b){
      b.summarize=e.checked;
      if(b.summarize){for(const[role,name,type]of roles)if(!roleColumn(b,role)){const c={id:uid('col'),name,role,type};b.columns.push(c);for(const r of b.rows)r.cells[c.id]='';}}
      changed();rerender();return;
    }
    if(panel){const key=p.id+':'+panel,d=formDrafts.get(key);if(d){if(e.id==='doc-block-kind')d.type=e.value;if(e.id==='doc-new-block-title')d.title=e.value;if(e.id==='doc-tag-name'||e.id==='doc-column-name')d.name=e.value;}}
    const tagForm=e.closest('.doc-tag-form');if(tagForm)formDrafts.set(p.id+':tag:'+tagForm.dataset.tag,e.value);
    const colForm=e.closest('.doc-column-form');if(colForm)formDrafts.set(p.id+':col:'+colForm.dataset.block+':'+colForm.dataset.column,e.value);
    if(e.id==='doc-source-name')p.sourceDraft.name=e.value;
    if(e.id==='doc-source-text')p.sourceDraft.text=e.value;
    if(e.id==='doc-source-file'){p.sourceDraft.fileName=e.files?.[0]?.name||'';$('#doc-file-name').textContent=p.sourceDraft.fileName||'文件只记录名称，不读取、不上传';}
    if(e.id==='doc-import-choice'&&p.pending)p.pending.choice=e.value;
    if(e.id==='doc-import-date'&&p.pending)p.pending.date=e.value;
    if($('#doc-import-apply')&&p.pending)$('#doc-import-apply').disabled=!p.pending.choice||!validDate(p.pending.date);
  }
  function undoRefresh(p){changed();if(state.page==='today'||state.page==='projects')refresh();}
  function click(e){
    if(e.hasAttribute('data-doc-clear-search')){query='';refresh();return true;}
    const p=current();if(!p)return false;
    if(e.dataset.docPanel){panel=panel===e.dataset.docPanel?'':e.dataset.docPanel;rerender();$('.doc-panel')?.scrollIntoView({block:'nearest'});return true;}
    if(e.hasAttribute('data-doc-close-panel')){panel='';refresh();return true;}
    if(e.dataset.docJump){jump(e.dataset.docJump);return true;}
    if(e.dataset.docAddRow){const b=block(p,e.dataset.docAddRow),r={id:uid('d'),cells:{}};for(const c of b.columns)r.cells[c.id]=c.type==='status'?'未提交':'';b.rows.push(r);changed();rerender('#doc-row-'+r.id+' input');return true;}
    if(e.dataset.docRemoveRow){const found=locate(e.dataset.docRemoveRow);if(!found)return true;const n=found.b.rows.indexOf(found.r);found.b.rows.splice(n,1);changed();refresh();toast('已移除交付记录',()=>{if(p.blocks.includes(found.b)&&!found.b.rows.some(r=>r.id===found.r.id)){found.b.rows.splice(n,0,found.r);undoRefresh(p);}});return true;}
    if(e.dataset.docRemoveBlock){const n=p.blocks.findIndex(b=>b.id===e.dataset.docRemoveBlock),removed=p.blocks.splice(n,1)[0];panel='';changed();refresh();toast('已移除内容块',()=>{if(!p.blocks.some(b=>b.id===removed.id)){p.blocks.splice(Math.min(n,p.blocks.length),0,removed);undoRefresh(p);}});return true;}
    if(e.dataset.docMove){const n=p.blocks.findIndex(b=>b.id===e.dataset.docMove),to=n+Number(e.dataset.step);if(to>=0&&to<p.blocks.length){[p.blocks[n],p.blocks[to]]=[p.blocks[to],p.blocks[n]];changed();refresh();}return true;}
    if(e.dataset.docRemoveColumn){
      const b=block(p,e.dataset.block),n=b.columns.findIndex(c=>c.id===e.dataset.docRemoveColumn),c=b.columns[n];
      if(b.summarize&&c.role)return true;
      const values=new Map(b.rows.map(r=>[r.id,r.cells[c.id]]));b.columns.splice(n,1);for(const r of b.rows)delete r.cells[c.id];changed();refresh();
      const restore=()=>{
        if(!p.blocks.includes(b)){toast('原清单已移除，不能在其他清单中恢复此列');return;}
        if(b.columns.some(x=>x.id===c.id))return;
        const replacement=c.role?b.columns.find(x=>x.role===c.role):null;
        const conflicts=replacement?b.rows.some(r=>{const next=r.cells[replacement.id]||'',old=values.get(r.id)||'';return next&&old&&next!==old;}):false;
        if(conflicts){toast('撤销遇到新值冲突：原数据保留，清空冲突值后可重试',restore);return;}
        const byName=b.columns.some(x=>x!==replacement&&x.name.toLowerCase()===c.name.toLowerCase());
        if(byName){toast('列名已被占用：先改名，再重试撤销',restore);return;}
        if(replacement)b.columns.splice(b.columns.indexOf(replacement),1);
        b.columns.splice(Math.min(n,b.columns.length),0,c);
        for(const r of b.rows){const newValue=replacement?r.cells[replacement.id]||'':'';r.cells[c.id]=values.get(r.id)||newValue;if(replacement)delete r.cells[replacement.id];}
        undoRefresh(p);
      };
      toast('已移除列及其内容',restore);return true;
    }
    if(e.dataset.docAddCheck){const b=block(p,e.dataset.docAddCheck),i={id:uid('check'),text:'',done:false};b.items.push(i);changed();rerender(`[data-doc-check-text="${i.id}"]`);return true;}
    if(e.dataset.docRemoveCheck){const b=p.blocks.find(b=>b.type==='checklist'&&b.items.some(i=>i.id===e.dataset.docRemoveCheck)),n=b.items.findIndex(i=>i.id===e.dataset.docRemoveCheck),item=b.items.splice(n,1)[0];changed();refresh();toast('已移除清单项',()=>{if(p.blocks.includes(b)){b.items.splice(n,0,item);undoRefresh(p);}});return true;}
    if(e.hasAttribute('data-doc-recheck-import')){if(p.reviewed)return true;p.pending=makeProposal(p);refresh();return true;}
    return false;
  }
  function uniqueName(name,values){return name.trim()&&!values.some(v=>v.toLowerCase()===name.trim().toLowerCase());}
  function formError(form,text){form.querySelector('[data-doc-form-error],.err').textContent=text;}
  function submit(form){
    if(form.id==='doc-create-form'){
      if(!uniqueName(createDraft.name,projects.map(p=>p.name))){$('#doc-create-error').textContent='请输入不重复的项目名称。';return true;}
      const p={id:uid('p'),group:'company',name:createDraft.name.trim(),description:createDraft.description.trim(),tags:[],blocks:[],sourceDraft:{name:'',text:'',fileName:''},pending:null,reviewed:true};projects.push(p);Object.assign(createDraft,{name:'',description:''});sync();nav(projectRoute(p));return true;
    }
    const p=current();if(!p)return false;
    if(form.id==='doc-add-block-form'){
      const d=formDrafts.get(p.id+':add');if(!d.title.trim()){formError(form,'请输入内容块标题。');return true;}
      const b={id:uid('block'),type:d.type,title:d.title.trim()};
      if(b.type==='text')b.text='';else if(b.type==='checklist')b.items=[];else Object.assign(b,{summarize:false,columns:[{id:uid('col'),name:'事项',type:'text',role:'subject'},{id:uid('col'),name:'备注',type:'text'}],rows:[]});
      p.blocks.push(b);formDrafts.delete(p.id+':add');panel='';changed();rerender();$('#doc-block-'+b.id)?.scrollIntoView({block:'center'});return true;
    }
    if(form.id==='doc-add-tag-form'){
      const name=$('#doc-tag-name').value.trim();if(!uniqueName(name,p.tags.map(t=>t.name))){formError(form,'阶段名称不能为空或重复。');return true;}p.tags.push({id:uid('tag'),name});formDrafts.get(p.id+':tags').name='';changed();refresh();return true;
    }
    if(form.classList.contains('doc-tag-form')){
      const tag=p.tags.find(t=>t.id===form.dataset.tag),name=form.querySelector('input').value.trim();if(!uniqueName(name,p.tags.filter(t=>t!==tag).map(t=>t.name))){formError(form,'阶段名称不能为空或重复。');return true;}tag.name=name;formDrafts.delete(p.id+':tag:'+tag.id);changed();refresh();return true;
    }
    if(form.id==='doc-add-column-form'){
      const b=block(p,form.dataset.block),name=$('#doc-column-name').value.trim();if(!uniqueName(name,b.columns.map(c=>c.name))){formError(form,'列名不能为空或重复。');return true;}const c={id:uid('col'),name,type:'text'};b.columns.push(c);for(const r of b.rows)r.cells[c.id]='';formDrafts.get(p.id+':'+panel).name='';changed();refresh();return true;
    }
    if(form.classList.contains('doc-column-form')){
      const b=block(p,form.dataset.block),c=b.columns.find(c=>c.id===form.dataset.column),name=form.querySelector('input').value.trim();if(!uniqueName(name,b.columns.filter(x=>x!==c).map(x=>x.name))){formError(form,'列名不能为空或重复。');return true;}c.name=name;formDrafts.delete(p.id+':col:'+b.id+':'+c.id);changed();refresh();return true;
    }
    if(form.id==='doc-source-form'){
      if(!p.sourceDraft.name.trim()||!p.sourceDraft.text.trim()){formError(form,'请填写资料名称与原始文字；文件尚未解析，不能只选文件就更新交付。');return true;}
      p.blocks.push({id:uid('source'),type:'text',title:p.sourceDraft.name.trim(),text:p.sourceDraft.text});p.sourceDraft={name:'',text:'',fileName:''};changed();nav(projectRoute(p));toast('已原样加入文档，未生成交期');return true;
    }
    if(form.id==='doc-apply-import'){
      const proposal=p.pending;if(!proposal||proposal.applied||p.reviewed)return true;
      const found=['d2','d3'].map(locate);
      if(found.some(x=>!x||x.p!==p||!x.b.summarize)||proposal.baseline!==targetSnapshot(p)){
        proposal.error='原记录、清单或阶段已改变，请重新核对。';formError(form,proposal.error);return true;
      }
      if(!proposal.choice||!validDate(proposal.date)){formError(form,'请选择日期并补齐年份。');return true;}
      const changes=found.map((entry,n)=>({target:proposalLabel(p,['d2','d3'][n]),oldDate:value(entry.b,entry.r,'date'),newDate:n===0?proposal.choice:proposal.date}));
      found[0].r.cells[roleColumn(found[0].b,'date').id]=proposal.choice;found[1].r.cells[roleColumn(found[1].b,'date').id]=proposal.date;
      p.blocks.push({id:uid('source'),type:'text',title:'已核对来源 · 演示交付变更',text:changes.map((c,n)=>`文档目标：${c.target}；日期 ${c.oldDate||'未填写'} → ${c.newDate}。\n${n===0?'示例原文标识 FG_021：交付表与截图日期冲突，经本人核对采用。':'示例原文标识 FG_024：截图写10/18，年份由本人补齐。'}`).join('\n\n')});proposal.applied=true;p.reviewed=true;changed();refresh();toast('已更新两条文档记录');return true;
    }
    return false;
  }
  function summary(id){const f=locate(id);if(!f)return '<p>这条文档记录已移除。</p>';return `<span class="meta">${esc(f.p.name)} / ${esc(f.b.title)}</span><h2>${esc(value(f.b,f.r,'subject'))}</h2><dl class="detail-properties">${f.b.columns.map(c=>`<dt>${esc(c.name)}</dt><dd>${esc(c.type==='stage'?stageName(f.p,f.r.cells[c.id]):f.r.cells[c.id]||'待补充')}</dd>`).join('')}</dl>${link(projectRoute(f.p)+'/row/'+id,'回到文档原行','pill')}`;}
  function afterRender(){const parts=state.object.split('/');if(state.page==='projects'&&parts[1]==='row')jump(parts[2]);}
  sync();
  return {render,input:handleInput,click,submit,summary,formatDate:date,afterRender,itemRoute:id=>{const f=locate(id);return f?projectRoute(f.p)+'/row/'+id:'projects';},reviewRoute:()=>projectRoute(get('film'))+'/import/pending'};
};
