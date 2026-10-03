/* 正常页面组件。全部状态只在当前演示内存中；不连接模型或后台服务。 */
window.createAzPages = function (api) {
  'use strict';
  const {D,state,esc,icon,action,detail,nav,refresh,toast} = api;
  const $ = s=>document.querySelector(s);
  const news=window.createAzNews({esc,icon,nav,toast});
  const models=window.createAzModels({state,esc,icon,nav,refresh});
  const projects=window.createAzProjects({D,state,esc,icon,nav,refresh,toast});
  let serial=10, stream=null;
  const sessions=[{id:'s1',title:'新对话',draft:'',messages:[]}];
  let activeSession='s1';
  let ideaFilter='全部',ideaQuery='',editId=null;
  const newIdeaDraft={title:'',body:'',tag:'流程'};
  const editDrafts=new Map();
  const currentIdeaDraft=()=>editId?editDrafts.get(editId):newIdeaDraft;
  const ideas=[
    {id:'i1',title:'把失败样例也留在项目资料里',body:'不只存最好的一张。把失败时的参考、参数和画面一起留下，下次才知道哪里不能照搬。',tag:'流程',date:'今天',todo:false},
    {id:'i2',title:'交付前生成一份版本清单',body:'整理本轮镜头、版本和输出位置，让 Agent 先列差异，确认后再更新正式记录。',tag:'项目',date:'昨天',todo:false},
    {id:'i3',title:'雨夜港口的光线变化',body:'近处暖光，远处冷雾。试试让反光先出现，再显出船体轮廓。',tag:'画面',date:'昨天',todo:false},
    {id:'i4',title:'把原始资料说明留在项目文档里',body:'回到项目时可以直接找到当时的要求和出处。',tag:'流程',date:'09/28',todo:false}
  ];
  const current=()=>sessions.find(s=>s.id===activeSession);
  const button=(label,attrs='',cls='pill')=>`<button type="button" class="${cls}" ${attrs}>${label}</button>`;
  function ideaCards(){
    const filtered=ideas.filter(i=>(ideaFilter==='全部'||i.tag===ideaFilter)&&`${i.title} ${i.body}`.toLowerCase().includes(ideaQuery.toLowerCase()));
    return filtered.length?filtered.map(i=>`<article class="idea-card"><div class="idea-card-meta"><span>${esc(i.tag)}</span><time>${esc(i.date)}</time></div><h2>${esc(i.title)}</h2><p>${esc(i.body)}</p><div class="idea-card-actions">${button('编辑',`data-edit-idea="${i.id}"`,'section-action')}${button(i.todo?'已转待办':'转待办',`data-todo-idea="${i.id}" ${i.todo?'disabled':''}`,'section-action')}${button('移除',`data-delete-idea="${i.id}"`,'section-action')}</div></article>`).join(''):'<div class="ideas-empty"><h2>这里还没有卡片</h2><p class="subtle">换个标签，或记下新的想法。</p></div>';
  }
  function ideasPage(){
    const ideaDraft=currentIdeaDraft();
    return `<div class="ideas-toolbar"><div class="filter-buttons" aria-label="灵感标签">${['全部','流程','项目','画面','工具'].map(t=>button(t,`data-idea-filter="${t}" aria-pressed="${t===ideaFilter}"`,'filter-button')).join('')}</div><label class="idea-search"><span class="meta">搜索</span><input class="input" id="idea-search" value="${esc(ideaQuery)}" placeholder="搜索卡片内容"></label></div><form class="idea-composer" id="idea-form"><div class="idea-fields"><label class="sr-label" for="idea-title">卡片标题</label><input id="idea-title" class="idea-title-input" maxlength="80" placeholder="一个新想法…" value="${esc(ideaDraft.title)}"><label class="sr-label" for="idea-body">卡片内容</label><textarea id="idea-body" maxlength="2000" placeholder="记下画面、流程、链接或还没想清楚的念头">${esc(ideaDraft.body)}</textarea></div><div class="idea-compose-actions"><label class="sr-label" for="idea-tag">标签</label><select id="idea-tag" class="select">${['流程','项目','画面','工具'].map(t=>`<option ${t===ideaDraft.tag?'selected':''}>${t}</option>`).join('')}</select><span class="meta">${editId?'编辑草稿暂存于本次演示':'仅本次演示保存'}</span>${editId?button('返回新建','data-cancel-edit') :''}<button type="submit" class="pill on">${editId?'保存修改':'收集灵感'}</button></div><p id="idea-error" class="err" role="alert"></p></form><div class="idea-grid" id="idea-grid">${ideaCards()}</div>`;
  }
  function messageHTML(m){
    return `<article class="chat-message ${m.role==='user'?'user-message':'assistant-message'}"><div class="message-avatar">${m.role==='user'?'我':'AZ'}</div><div class="message-body"><div class="message-author">${m.role==='user'?'你':'Agent'}${m.role==='assistant'?'<span class="meta">演示回复</span>':''}</div><p data-message="${m.id}">${esc(m.text)}</p>${m.interrupted?'<p class="message-interrupted">已停止生成</p>':''}</div></article>`;
  }
  function sessionList(){return sessions.map(s=>`<button class="session-item" data-session="${s.id}" aria-current="${s.id===activeSession?'true':'false'}"><span>${esc(s.title)}</span><small>${stream?.sessionId===s.id?'回复中':'本次会话'}</small></button>`).join('');}
  function chatPage(){
    const s=current(),busy=stream?.sessionId===s.id;
    return `<div class="chat-layout"><aside class="chat-sessions"><header><h2>会话</h2>${button(icon('plus'),'data-new-chat aria-label="新建对话"','icon-btn')}</header><div id="session-list">${sessionList()}</div><p class="meta">会话仅保留在本次演示。</p></aside><section class="conversation"><header class="conversation-header"><h2 id="chat-title">${esc(s.title)}</h2><span class="meta">通用 Agent</span></header><div class="chat-messages" id="chat-messages" role="log" aria-label="对话消息" aria-live="off">${s.messages.length?s.messages.map(messageHTML).join(''):'<div class="chat-welcome"><span class="welcome-mark">AZ</span><h2>有什么需要一起处理？</h2><p>直接提问，或告诉我你要做的事。</p></div>'}</div><form class="chat-composer" id="chat-form"><div class="composer-meta"><label for="chat-model">模型</label><select id="chat-model" aria-label="模型"><option>演示模型 · 未连接</option></select><span>工作区：AZCine</span><span>写入需确认</span></div><label class="sr-label" for="chat-input">发送消息</label><textarea id="chat-input" maxlength="8000" placeholder="输入消息，Shift + Enter 换行…" rows="3">${esc(s.draft)}</textarea><div class="chat-input-foot"><span class="meta">${busy?'正在播放演示回复':'不发起真实模型调用'}</span><button type="button" class="pill" data-stop-chat ${busy?'':'hidden'}>停止</button><button class="pill on" id="chat-send" type="submit" ${busy?'disabled':''}>发送 ${icon('arrow')}</button></div><p id="chat-error" class="err" role="alert"></p></form><div class="sr-label" id="chat-announcement" role="status"></div></section></div>`;
  }
  function jobsPage(){return `<div class="jobs-page"><section class="job-section"><header class="section-heading"><h2>归集一致性测试资料</h2><span class="status-text">${state.job==='running'?'处理中':'已取消'}</span>${state.job==='running'?action('cancel-job','取消任务','pill section-action'):''}</header><ul class="log-list"><li><time>09:10</time><span>读取示例引用 · 完成</span></li><li><time>09:11</time><span>合并重复材料 · 完成</span></li><li><time>09:12</time><span>${state.job==='running'?'整理来源与步骤 · 处理中':'任务已取消，原始材料未改动'}</span></li></ul><p class="meta">固定过程演示，没有实际后台执行。</p></section><section class="job-section"><header class="section-heading"><h2>雾港交期调整</h2><span class="status-text">${state.reviewed?'已核对':'等你核对'}</span>${!state.reviewed?action('review','核对变更','pill on section-action'):''}</header><p class="subtle">${state.reviewed?'两条文档交付记录已在本次演示中更新。':'2 项变更仍是草案，正式交期未改。'}</p></section><section class="job-section"><header class="section-heading"><h2>整理今日资讯</h2><span class="meta">已完成 · 09:12</span><button class="section-action" data-nav="news">阅读日报 ${icon('arrow')}</button></header></section></div>`;}
  function settingsPage(){return `<div class="settings-page"><section class="settings-section"><h2>外观</h2><div class="settings-row"><span>主题</span><div class="theme-choices">${['light','dark'].map(t=>button(t==='light'?'浅色':'深色',`data-set-theme="${t}" aria-pressed="${document.documentElement.dataset.theme===t}"`)).join('')}</div><span class="meta">切换后立即生效</span></div></section><section class="settings-section"><h2>资讯</h2><div class="settings-row"><span>每日整理</span><span class="num">09:00 · 北京时间</span><span class="meta">过去 24 小时；演示配置</span></div><div class="settings-row"><span>关注领域</span><div>大模型前沿<br>AI 行业动态<br>AI 视频、图片 / CG 应用</div><span class="meta">领域编辑在后续流程稿补齐</span></div></section><section class="settings-section"><h2>Agent</h2><div class="settings-row"><span>连接</span><span>模型未连接</span><span class="meta">设计稿不读取密钥</span></div><div class="settings-row"><span>原生能力</span><span>Skills · 扩展 · 工具 · 自定义模型</span><span class="meta">保留 Pi 能力，尚未集成</span></div></section></div>`;}
  function render(page,id){
    return ({projects:()=>projects.render(id),news:()=>news.render(id),models:models.render,ideas:ideasPage,agent:chatPage,jobs:jobsPage,settings:settingsPage}[page]||(()=>''))();
  }
  function refreshCards(){if($('#idea-grid'))$('#idea-grid').innerHTML=ideaCards();}
  function finishIdeaSave(){
    if(editId)editDrafts.delete(editId);
    else Object.assign(newIdeaDraft,{title:'',body:'',tag:'流程'});
    editId=null;
  }
  function click(b){
    if(news.click(b)||projects.click(b)||models.click(b))return true;
    if(b.dataset.route){nav(b.dataset.route);return true;}
    if(b.dataset.ideaFilter){ideaFilter=b.dataset.ideaFilter;document.querySelectorAll('[data-idea-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.ideaFilter===ideaFilter)));refreshCards();return true;}
    if(b.hasAttribute('data-new-idea')){nav('ideas');$('#idea-title')?.focus();return true;}
    if(b.dataset.editIdea){const i=ideas.find(i=>i.id===b.dataset.editIdea);editId=i.id;if(!editDrafts.has(i.id))editDrafts.set(i.id,{title:i.title,body:i.body,tag:i.tag});refresh();$('#idea-title').focus();return true;}
    if(b.hasAttribute('data-cancel-edit')){editId=null;refresh();$('#idea-title').focus();return true;}
    if(b.dataset.deleteIdea){const n=ideas.findIndex(i=>i.id===b.dataset.deleteIdea),removed=ideas.splice(n,1)[0];if(editId===removed.id)editId=null;refresh();toast('已移除卡片',()=>{ideas.splice(n,0,removed);if(state.page==='ideas')refresh();});return true;}
    if(b.dataset.todoIdea){const i=ideas.find(i=>i.id===b.dataset.todoIdea);if(i.todo)return true;const id='t'+(++serial);D.todos.push({id,title:i.title,detail:i.body,context:'来自灵感',done:false});i.todo=true;refreshCards();toast('已加入今天的待办',()=>{const n=D.todos.findIndex(t=>t.id===id);if(n>=0)D.todos.splice(n,1);i.todo=false;refresh();});return true;}
    if(b.dataset.session){activeSession=b.dataset.session;refresh();$('#chat-input').focus();scrollMessages();return true;}
    if(b.hasAttribute('data-new-chat')){const s={id:'s'+(++serial),title:'新对话',draft:'',messages:[]};sessions.unshift(s);activeSession=s.id;refresh();$('#chat-input').focus();return true;}
    if(b.hasAttribute('data-stop-chat')){stopStream();return true;}
    return false;
  }
  function input(e){
    news.input(e);projects.input(e);
    if(e.id==='chat-input')current().draft=e.value;
    if(e.id==='idea-title')currentIdeaDraft().title=e.value;
    if(e.id==='idea-body')currentIdeaDraft().body=e.value;
    if(e.id==='idea-tag')currentIdeaDraft().tag=e.value;
    if(e.id==='idea-search'){ideaQuery=e.value;refreshCards();}
  }
  function scrollMessages(){const box=$('#chat-messages');if(box)box.scrollTop=box.scrollHeight;}
  function chatControls(){
    if(state.page!=='agent')return;
    const busy=stream?.sessionId===activeSession;
    $('[data-stop-chat]').hidden=!busy;$('#chat-send').disabled=busy;
    $('.chat-input-foot .meta').textContent=busy?'正在播放演示回复':'不发起真实模型调用';
    $('#session-list').innerHTML=sessionList();
  }
  function stopStream(){if(!stream||stream.sessionId!==activeSession)return;clearInterval(stream.timer);const s=sessions.find(s=>s.id===stream.sessionId),m=s.messages.find(m=>m.id===stream.messageId);m.interrupted=true;stream=null;if(state.page==='agent'){const draft=current().draft;$('#chat-messages').innerHTML=current().messages.map(messageHTML).join('');chatControls();$('#chat-input').value=draft;$('#chat-announcement').textContent='已停止生成';}}
  function send(){
    const s=current();if(stream?.sessionId===s.id)return;
    const text=s.draft.trim();if(!text){$('#chat-error').textContent='请输入消息，不能只输入空格。';$('#chat-input').focus();return;}
    if(stream){$('#chat-error').textContent='另一段会话仍在回复，请先切回停止或等待结束。';return;}
    s.messages.push({id:'m'+(++serial),role:'user',text});s.draft='';if(s.messages.length===1)s.title=text.length>16?text.slice(0,16)+'…':text;
    const reply={id:'m'+(++serial),role:'assistant',text:''};s.messages.push(reply);
    const response='已收到你的消息。这里展示的是通用对话的交互：你可以继续补充内容，消息会保留在这段会话里。\n\n当前使用固定演示回复，尚未连接模型；不会读取文件、执行工具或更改项目记录。';
    stream={sessionId:s.id,messageId:reply.id,timer:null,position:0};refresh();$('#chat-input').focus();scrollMessages();
    stream.timer=setInterval(()=>{
      if(!stream)return;
      stream.position+=5;reply.text=response.slice(0,stream.position);
      if(state.page==='agent'&&activeSession===s.id){const p=document.querySelector(`[data-message="${reply.id}"]`);const box=$('#chat-messages');const near=box.scrollHeight-box.scrollTop-box.clientHeight<80;if(p)p.textContent=reply.text;if(near)scrollMessages();}
      if(stream.position>=response.length){clearInterval(stream.timer);stream=null;chatControls();if($('#chat-announcement'))$('#chat-announcement').textContent='演示回复完成';}
    },40);
  }
  function submit(form){
    if(projects.submit(form))return true;
    if(form.id==='chat-form'){send();return true;}
    if(form.id==='idea-form'){
      const ideaDraft=currentIdeaDraft();
      const title=ideaDraft.title.trim(),body=ideaDraft.body.trim();if(!title&&!body){$('#idea-error').textContent='先写下标题或内容。';$('#idea-title').focus();return true;}
      if(editId){const i=ideas.find(i=>i.id===editId);Object.assign(i,{title:title||body.slice(0,30),body,tag:ideaDraft.tag});}
      else ideas.unshift({id:'i'+(++serial),title:title||body.slice(0,30),body,tag:ideaDraft.tag,date:'刚刚',todo:false});
      finishIdeaSave();ideaFilter='全部';ideaQuery='';refresh();toast('已收集 · 仅本次演示');return true;
    }
    return false;
  }
  let composing=false;
  document.addEventListener('compositionstart',e=>{if(e.target.id==='chat-input')composing=true;});
  document.addEventListener('compositionend',e=>{if(e.target.id==='chat-input')composing=false;});
  document.addEventListener('keydown',e=>{if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();send();}});
  return {render,click,input,submit,projectSummary:projects.summary,projectDate:projects.formatDate,projectItemRoute:projects.itemRoute,projectReviewRoute:projects.reviewRoute,beforeRender:news.beforeRender,restoreScroll:()=>{news.restoreList();projects.afterRender();},afterRender:()=>{if(state.page==='agent')scrollMessages();news.afterRender(state.page==='news');projects.afterRender();},addIdea:text=>ideas.unshift({id:'i'+(++serial),title:text.slice(0,30),body:text,tag:'流程',date:'刚刚',todo:false})};
};
