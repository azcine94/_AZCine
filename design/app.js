/* 工作台页面稿：主导航正常切页；仅本次打开的内存状态，主题可保存。 */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const D = structuredClone(window.AZ_V2);
  const variant = document.body.dataset.direction;
  const directions = {A:['主次拼贴','workspace-a.html'], B:['工作双栏','workspace-b.html'], C:['交付优先','workspace-c.html']};
  const state = {selected:'e1',reviewed:false,view:'normal',job:'running',page:'today',object:''};
  const pageNames={today:'今天',projects:'项目',news:'资讯',models:'模型榜',ideas:'灵感',agent:'Agent',jobs:'后台任务',settings:'设置',help:'原型说明',todo:'待办'};
  let pages;
  let returnFocus, toastTimer, undo;
  const paths = {
    today:'<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4m8-4v4M3 10h18m-13 5h3"/>',
    projects:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    news:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    models:'<path d="M4 21h17M6 17v-5h3v5m3 0V7h3v10m3 0V3h3v14"/>',
    ideas:'<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/>',
    agent:'<path d="m5 7 5 5-5 5m8 0h6"/>',
    jobs:'<path d="M4 12h3l3-8 4 16 3-8h3"/>',
    settings:'<path d="M5 4v16m7-16v16m7-16v16M2 8h6m1 8h6m1-7h6"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    review:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 11 2 2 5-5M8 17h8"/>'
  };
  const icon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || paths.arrow}</svg>`;
  const action = (name,label,cls='pill',extra='') => `<button type="button" class="${cls}" data-action="${name}" ${extra}>${label}</button>`;
  function themeLabel() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('[data-action="theme"]').forEach(b => { b.innerHTML = icon(dark?'sun':'moon') + (dark?'浅色':'深色'); b.setAttribute('aria-label',dark?'切换为浅色主题':'切换为深色主题'); });
    document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.setTheme === (dark?'dark':'light'))));
    document.querySelectorAll('.direction-links a').forEach(a => { const u = new URL(a.href); u.searchParams.set('theme',dark?'dark':'light'); u.hash=location.hash; a.href=u.href; });
  }
  function setTheme(value) {
    document.documentElement.dataset.theme=value;
    try { localStorage.setItem('azcine-v2-theme',value); } catch { /* 主题仍在当前页生效，不声称持久保存。 */ }
    const u = new URL(location.href); u.searchParams.set('theme',value); history.replaceState(null,'',u);
    themeLabel();
  }
  function shell() {
    $('#app').innerHTML = `<header class="titlebar"><span class="preview-title">AZCine · ${variant} / ${directions[variant][0]}</span><span id="data-kind">虚构数据</span><div class="direction-links" aria-label="比较首屏方向">${Object.entries(directions).map(([k,v])=>`<a href="${v[1]}" aria-label="方向 ${k}：${v[0]}" ${k===variant?'aria-current="page"':''}>${k}</a>`).join('')}</div>${action('theme','','theme-button')}</header>
      <div class="app-shell"><aside class="side"><div class="brand"><img class="brand-lockup" src="../assets/brand/logo-lockup.png" alt="AZCine"></div><nav aria-label="主导航">${[['today','今天'],['projects','项目'],['news','资讯'],['models','模型榜'],['ideas','灵感'],['agent','Agent'],['jobs','后台任务']].map(([id,name],i)=>`${i===5?'<div class="nav-gap"></div>':''}<button class="nav-item" data-nav="${id}" ${id==='today'?'aria-current="page"':''}>${icon(id)}<span>${name}</span>${id==='jobs'?'<span class="nav-count" id="nav-count">1</span>':''}</button>`).join('')}</nav><div class="side-bottom"><button class="nav-item" data-nav="settings">${icon('settings')}<span>设置</span></button><button class="nav-item" data-action="help">${icon('help')}<span>原型说明</span></button></div></aside><main class="workspace"><header class="page-heading"><div class="page-name"><h1>今天</h1><span class="meta">10 月 1 日 · 周四</span></div>${action('note',icon('plus')+'记一笔')}</header><div id="review"></div><div id="home-content"></div><footer class="job-strip" id="job-strip"></footer></main></div>`;
    readRoute(); renderPage();
  }
  function reviewCard() {
    return `<section class="today-card review-card"><header class="card-heading"><span class="card-kicker">${icon('review')}${state.reviewed?'已经处理':'待你确认'}</span><span class="card-state">${state.reviewed?'已核对':'2 项变更'}</span></header><div class="review-card-body"><p class="card-context">雾港 · 片头</p><h2>${state.reviewed?'交付记录已更新':'交期调整，等你核对'}</h2><p class="card-description">${state.reviewed?'两条交付记录已在本次演示中更新。':'日期有冲突，正式交付安排尚未改动。'}</p></div><footer>${state.reviewed?`<button class="pill on" data-nav="projects/film">打开项目 ${icon('arrow')}</button>`:action('review','核对变更 '+icon('arrow'),'pill on')}</footer></section>`;
  }
  function heading(title,meta='',nav='') { return `<div class="section-heading"><h2>${title}</h2>${meta?`<span class="meta">${meta}</span>`:''}${nav?`<button class="section-action" data-nav="${nav}">${nav==='news'?'读日报':'查看项目'}${icon('arrow')}</button>`:''}</div>`; }
  function tasks() { return D.todos.map(t=>`<div class="task-row ${t.done?'is-done':''}"><button class="check-target" data-check="${t.id}" aria-label="${t.done?'取消完成':'完成'}：${esc(t.title)}" aria-pressed="${t.done}"></button><button class="row-main" data-select="${t.id}"><b>${esc(t.title)}</b><span class="meta">${esc(t.context)}</span></button></div>`).join(''); }
  function delivery(d) { return `<button class="delivery-row" data-select="${d.id}"><span class="delivery-text"><b>${esc(d.name)}</b><span class="meta">${esc(d.project)} · <span class="node">${esc(d.node)}</span></span></span><span class="date-label ${state.reviewed?'updated':''}">${pages.projectDate(d.date)}</span></button>`; }
  function event(e,compact=false) { return compact ? `<button class="compact-event ${state.selected===e.id?'selected-row':''}" data-select="${e.id}" aria-pressed="${state.selected===e.id}"><span class="event-line"><b>${esc(e.title)}</b><span class="meta">${esc(e.category)} · ${e.sources.length} 个来源</span></span></button>` : `<button class="event" data-select="${e.id}"><span class="category">${esc(e.category)}</span><strong>${esc(e.title)}</strong><span class="summary">${esc(e.summary)}</span><span class="source">${e.sources.length} 个来源 · 09:12</span></button>`; }
  function jobsFooter() { $('#job-strip').innerHTML=`<button data-nav="jobs"><span class="dot ${state.job==='running'?'acc':''}"></span><span>归集一致性测试资料</span><span class="job-state">${state.job==='running'?'处理中':'已取消'}</span><span class="job-action">查看过程</span>${icon('arrow')}</button>`; }
  function renderHome() {
    $('#review').innerHTML=''; $('#nav-count').hidden=state.reviewed; jobsFooter();
    const root=$('#home-content');
    if(state.view!=='normal') {
      const copy={empty:['今天还没有工作','添加一条待办，或从项目安排今天要做的事。'],loading:['正在载入今天的工作','加载状态预览，不会发起真实请求。'],error:['今天的工作未载入','暂时无法读取记录。保留当前数据，可以重试。']}[state.view];
      root.innerHTML=`<section class="preview-state" role="status"><h2>${copy[0]}</h2><p>${copy[1]}</p>${state.view==='loading'?'<div class="skeleton"></div><div class="skeleton"></div>':''}${state.view==='empty'?action('note','添加待办','pill on'):''}${action('normal',state.view==='error'?'重试预览':'返回正常状态')}</section>`; return;
    }
    const next=D.deliveries[0],dueCount=next?D.deliveries.filter(d=>d.date===next.date).length:0;
    const work=`<section class="today-card today-tasks-card"><header class="card-heading"><h2>今天要做</h2><span class="card-count">${D.todos.filter(t=>!t.done).length} 项待办</span></header><div class="card-tasks">${tasks()||'<p class="subtle">今天还没有待办。</p>'}</div><footer>${action('note',icon('plus')+'记一笔','section-action')}</footer></section>`;
    const upcoming=`<section class="today-card today-delivery-card"><header class="card-heading"><h2>接下来交付</h2><button class="section-action" data-nav="projects">项目 ${icon('arrow')}</button></header>${next?`<div class="home-due-feature"><time class="num">${pages.projectDate(next.date)}</time><div><span>最近交付</span><b>${dueCount} 项待交</b></div></div><div class="card-deliveries">${D.deliveries.slice(0,3).map(delivery).join('')}</div>`:'<div class="card-empty"><p>还没有已安排的交付。</p><button class="section-action" data-nav="projects">打开公司项目</button></div>'}</section>`;
    const news=`<section class="today-card today-news-card"><header class="card-heading"><h2>今日资讯</h2><button class="section-action" data-nav="news">读日报 ${icon('arrow')}</button></header><div class="events">${D.events.map((e,n)=>`<button class="home-news-item" data-select="${e.id}"><span class="home-news-number num">${String(n+1).padStart(2,'0')}</span><span class="home-news-copy"><span class="category">${esc(e.category)} · ${e.sources.length} 个来源</span><strong>${esc(e.title)}</strong><span class="summary">${esc(e.summary)}</span></span></button>`).join('')}</div></section>`;
    root.innerHTML=`<div class="today-cards today-cards-${variant.toLowerCase()}">${reviewCard()}${work}${upcoming}${news}</div>`;
  }
  function detail(id,inline=false) {
    const e=D.events.find(x=>x.id===id);
    if(e) return `<div class="detail-top"><span class="meta">${esc(e.category)}</span>${inline?action('expand',icon('arrow'),'icon-btn','aria-label="展开详情"'):''}</div><h2>${esc(e.title)}</h2><p class="detail-copy">${esc(e.summary)}</p><section class="detail-block"><h3>原始材料</h3><p>${esc(e.fact)}</p></section><section class="detail-block"><h3>Agent 分析</h3><p>${esc(e.analysis)}</p></section><section class="detail-block"><h3>来源 · ${e.sources.length}</h3>${e.sources.map(s=>`<p>${esc(s)} · 示例摘要</p>`).join('')}<p class="meta">来源与内容均为虚构，不是实际新闻。</p></section>`;
    const t=D.todos.find(x=>x.id===id);
    if(t) return `<span class="meta">${esc(t.context)}</span><h2>${esc(t.title)}</h2><p class="detail-copy">${esc(t.detail)}</p><dl class="detail-properties"><dt>安排</dt><dd>今天</dd><dt>状态</dt><dd>${t.done?'已完成':'待办'}</dd></dl><p class="meta">这是个人待办，不会更改项目交付节点。</p>`;
    return pages.projectSummary(id);
  }
  function show(title,body,opener=document.activeElement) {
    const modal=$('#modal');
    if(!modal.open) returnFocus=opener;
    $('#modal-title').textContent=title; $('#modal-body').innerHTML=body;
    if(!modal.open) modal.showModal();
    $('#close-modal').focus(); modal.scrollTop=0;
  }
  function close() { $('#modal').close(); }
  function toast(text,undoFn=null) {
    clearTimeout(toastTimer); undo=undoFn;
    $('#toast').innerHTML=`<span>${esc(text)}</span>${undoFn?action('undo','撤销','section-action'):''}`; $('#toast').hidden=false;
    toastTimer=setTimeout(()=>{ $('#toast').hidden=true; undo=null; },7000);
  }
  function objectRoute(id){return id.startsWith('d')?pages.projectItemRoute(id):(id.startsWith('e')?'news':'todo')+'/'+id;}
  function select(id) {
    state.selected=id;
    nav(objectRoute(id));
  }
  function review() { nav(pages.projectReviewRoute()); }
  function note() {
    show('记一笔',`<form id="note-form"><label for="note-text">内容</label><textarea class="textarea" id="note-text" required maxlength="300" placeholder="写下一个想法，或今天要做的事…"></textarea><label for="note-kind">记到哪里</label><select class="select" id="note-kind"><option value="idea">灵感</option><option value="todo" ${state.view==='empty'?'selected':''}>今天的待办</option></select><p class="meta">仅保留在本次演示，刷新后还原。</p><p class="err" id="note-error" role="alert"></p><div class="foot">${action('close','取消')}<button type="submit" class="pill on">记下</button></div></form>`);
    $('#note-text').focus();
  }
  function readRoute(){
    const route=location.hash.slice(1).split('/');
    if(route[0]==='research'){route.splice(0,route.length,'models');const u=new URL(location.href);u.hash='models';history.replaceState(null,'',u);}
    state.page=Object.hasOwn(pageNames,route[0])?route[0]:'today';
    state.object=route.slice(1).join('/');
  }
  function renderPage(){
    pages.beforeRender();
    const page=state.page;
    document.querySelectorAll('.side [data-nav]').forEach(b=>{if(b.dataset.nav===page||(page==='todo'&&b.dataset.nav==='today'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('.workspace').dataset.page=page;
    $('#data-kind').textContent=page==='models'?'公开快照':'虚构数据';
    $('.page-heading').innerHTML=`<div class="page-name"><h1 tabindex="-1">${pageNames[page]}</h1>${page==='today'?'<span class="meta">10 月 1 日 · 周四</span>':''}</div>${page==='today'?action('note',icon('plus')+'记一笔'):page==='ideas'?'<span class="meta">想法先留下，不必立刻变成任务</span>':''}`;
    $('#review').hidden=page!=='today';$('#job-strip').hidden=page!=='today';
    $('#nav-count').hidden=state.reviewed;
    if(page==='today')renderHome();
    else if(page==='todo')$('#home-content').innerHTML=`<button class="section-action" data-nav="today">← 今天</button><article class="reading-body">${detail(state.object)}</article>`;
    else if(page==='help')$('#home-content').innerHTML=helpContent();
    else $('#home-content').innerHTML=pages.render(page,state.object);
    themeLabel();pages.afterRender();
    $('.workspace').dataset.route=state.page+(state.object?'/'+state.object:'');
  }
  function applyRoute(){
    // 点击导航、历史遍历与直接改 hash 使用同一收尾，焦点不回到旧页面。
    returnFocus=null;
    if($('#modal').open)close();
    readRoute();renderPage();window.scrollTo(0,0);pages.restoreScroll();$('.page-heading h1').focus({preventScroll:true});
  }
  function nav(route){
    const u=new URL(location.href);u.hash=route;
    if(u.href!==location.href)history.pushState(null,'',u);
    applyRoute();
  }
  window.addEventListener('popstate',applyRoute);
  window.addEventListener('hashchange',applyRoute);
  function helpContent() {
    return `<div class="reading-body"><p>顶部 A / B / C 只比较首页布局。主导航切换正常页面，右上角切换亮暗。</p><section class="detail-block"><h3>可以试什么</h3><p>公司项目文档与交付摘要、待办完成与撤销、日期核对；模型榜前30与来源说明；Agent连续对话与停止；灵感卡片编辑、筛选与转待办。</p></section><section class="detail-block"><h3>演示范围</h3><p>项目、资讯与聊天为虚构示例，业务记录刷新还原。模型榜使用Arena官方公开快照，获取时间与数据截止分别标明，不是实时榜单。未连接Pi、模型、应用抓取与系统后台；不要输入真实资料或密钥。</p></section><section class="detail-block"><h3>预览首页状态</h3><div class="foot">${[['normal','正常'],['empty','空'],['loading','加载'],['error','失败']].map(([k,v])=>`<button class="pill" data-state="${k}" aria-pressed="${state.view===k}">${v}</button>`).join('')}</div></section><section class="detail-block"><h3>预览模型榜状态</h3><div class="foot">${[['normal','正常'],['empty','空'],['loading','加载'],['error','失败']].map(([k,v])=>`<button class="pill" data-model-preview="${k}">${v}</button>`).join('')}</div></section></div>`;
  }
  document.addEventListener('click', async ev => {
    const b=ev.target.closest('button,a[data-route]'); if(!b || b.disabled) return;
    if(b.tagName==='A'){if(ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;ev.preventDefault();}
    if(pages.click(b))return;
    if(b.dataset.nav) { nav(b.dataset.nav); return; }
    if(b.dataset.select) { select(b.dataset.select); return; }
    if(b.dataset.check) {
      const t=D.todos.find(x=>x.id===b.dataset.check),before=t.done; t.done=!t.done; renderHome(); document.querySelector(`[data-check="${t.id}"]`)?.focus();
      toast(t.done?'已完成待办':'已恢复待办',()=>{t.done=before;renderPage();}); return;
    }
    if(b.dataset.setTheme) { setTheme(b.dataset.setTheme); return; }
    if(b.dataset.state) { state.view=b.dataset.state; nav('today'); return; }
    switch(b.dataset.action) {
      case 'theme': setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'); break;
      case 'review': review(); break;
      case 'note': note(); break;
      case 'close': close(); break;
      case 'help': nav('help'); break;
      case 'normal': state.view='normal'; renderHome(); break;
      case 'expand': nav(objectRoute(state.selected)); break;
      case 'undo': {const callback=undo;undo=null;$('#toast').hidden=true;if(callback)callback();break;}
      case 'cancel-job': state.job='cancelled'; renderPage(); break;
    }
  });
  document.addEventListener('input',ev=>{
    pages.input(ev.target);
  });
  document.addEventListener('submit',ev=>{
    ev.preventDefault();
    if(pages.submit(ev.target))return;
    if(ev.target.id==='note-form') {
      const text=$('#note-text').value.trim(); if(!text){$('#note-error').textContent='请写下内容，不能只输入空格。'; $('#note-text').focus();return;}
      if($('#note-kind').value==='todo') D.todos.push({id:`t${Date.now()}`,title:text,context:'个人待办',detail:text,done:false}); else pages.addIdea(text);
      state.view='normal'; close(); renderPage(); toast('已记下 · 刷新页面后还原');
    }
  });
  $('#close-modal').addEventListener('click',close);
  $('#modal').addEventListener('close',()=>{ if($('#modal').open)return; if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true}); else $('.page-heading h1')?.focus({preventScroll:true}); });
  pages=window.createAzPages({D,state,esc,icon,action,detail,nav,refresh:renderPage,toast});
  shell();
})();
