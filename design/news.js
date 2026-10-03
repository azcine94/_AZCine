/* AIHOT 结构参考；全部新闻数据为虚构。仅本次会话状态，未接入采集服务。 */
window.createAzNews=function({esc,icon,nav,toast}){
  const $=s=>document.querySelector(s);
  const items=structuredClone(window.AZ_NEWS);
  const fields=['大模型前沿','AI 行业动态','AI 视频、图片 / CG 应用'];
  const saved=new Set();
  const view={field:'全部',query:'',savedOnly:false,scroll:0};
  const dailyIds=['e1','e2','e3'];
  const daily=items.filter(i=>dailyIds.includes(i.id));
  // 本刊独立快照；三个出口使用同一组有序文本块，不各自拼接刊头或正文。
  const edition=structuredClone({
    brand:'AZCine / DAILY',date:'2026-10-01',title:'AI 日报',
    published:'星期四 · 09:12 · v2',
    window:'时间窗口：2026-09-30 09:00 — 2026-10-01 09:00（北京时间）',
    intro:'从工具恢复到多镜头测试：让工作过程可以回查。',
    notice:'虚构新闻样例 · 非真实报道',takeawaysTitle:'今日看点',
    takeaways:daily.map(i=>({id:i.id,title:i.title})),
    sections:fields.map(field=>({field,stories:daily.filter(i=>i.field===field)})),
    footer:'AZCine · 2026-10-01 · v2 · 虚构样例，不自动发送'
  });
  const dailyBlocks=[
    {key:'brand',type:'brand',text:edition.brand},
    {key:'date',type:'date',text:edition.date},
    {key:'published',type:'meta',text:edition.published},
    {key:'title',type:'title',text:edition.title},
    {key:'intro',type:'intro',text:edition.intro},
    {key:'notice',type:'meta',text:edition.notice},
    {key:'window',type:'meta',text:edition.window},
    {key:'takeaways-title',type:'takeaways-title',text:edition.takeawaysTitle},
    ...edition.takeaways.map((i,n)=>({key:'takeaway-'+i.id,type:'takeaway',itemId:i.id,text:`${n+1}. ${i.title}`})),
    ...edition.sections.flatMap((section,n)=>[
      {key:'section-'+n,type:'section',text:section.field},
      ...section.stories.flatMap(i=>[
        {key:i.id+'-title',type:'story-title',itemId:i.id,text:i.title},
        {key:i.id+'-summary',type:'summary',text:i.summary},
        {key:i.id+'-reason',type:'reason',text:'推荐理由（Agent 判断）：'+i.reason},
        {key:i.id+'-sources',type:'sources',text:'来源：'+i.sources.map(s=>s.name+' '+s.url).join('；')}
      ])
    ]),
    {key:'footer',type:'footer',text:edition.footer}
  ];
  let activeId='',selectedSource=0,onList=false,wasList=false;
  const bookmark=id=>`<button type="button" class="news-bookmark icon-btn" data-bookmark="${id}" aria-pressed="${saved.has(id)}" aria-label="${saved.has(id)?'取消收藏':'收藏'}：${esc(items.find(i=>i.id===id).title)}"><svg viewBox="0 0 24 24" fill="${saved.has(id)?'currentColor':'none'}" stroke="currentColor" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg></button>`;
  const link=(id,text,cls='news-title')=>`<a class="${cls}" href="#news/${id}" data-route="news/${id}">${esc(text)}</a>`;
  function filtered(){return items.filter(i=>(view.field==='全部'||i.field===view.field)&&(!view.savedOnly||saved.has(i.id))&&`${i.title} ${i.summary} ${i.sources.map(s=>s.name).join(' ')}`.toLowerCase().includes(view.query.toLowerCase().trim()));}
  function sourceList(i){return `<ul class="news-sources">${i.sources.map(s=>`<li><b>${esc(s.name)}</b><span>${esc(s.channel)} · ${s.published}</span><span>${s.full?'已保留正文样例':'仅摘要 / 链接'}</span></li>`).join('')}</ul>`;}
  function story(i){return `<div class="news-entry"><div class="news-time"><time datetime="${i.date}T${i.time}:00+08:00">${i.time}</time><span></span></div><article class="digest-story news-card" data-category="${esc(i.field)}"><header class="news-source-line"><span>${esc(i.sources[0].name)} · ${esc(i.sources[0].channel)}</span><span class="news-kind">${esc(i.kind)}</span>${bookmark(i.id)}</header><h2>${link(i.id,i.title)}</h2><p class="news-summary">${esc(i.summary)}</p>${i.updates.length?`<p class="news-latest"><b>最新进展</b> ${i.updates.at(-1).time} · ${esc(i.updates.at(-1).text)}</p>`:''}<div class="news-expansions">${i.sources.length>1?`<details><summary>另 ${i.sources.length-1} 个来源报道</summary>${sourceList(i)}</details>`:''}${i.updates.length?`<details><summary>${i.updates.length} 条进展</summary><ul class="news-updates">${i.updates.map(u=>`<li><time>${u.time}</time><span>${esc(u.text)}</span></li>`).join('')}</ul></details>`:''}</div><p class="news-reason"><b>推荐理由</b> ${esc(i.reason)}<span> · Agent 判断</span></p></article></div>`;}
  function feed(){const list=filtered();if(!list.length)return `<section class="news-empty"><h2>没有符合条件的资讯</h2><p>换个分类或关键词再试。</p><button class="pill" data-news-reset>重置筛选</button></section>`;return [...new Set(list.map(i=>i.date))].map(date=>`<section class="news-day"><header class="news-day-heading"><h2>${date==='2026-10-01'?'10 月 1 日':'9 月 30 日'}</h2><span>${date==='2026-10-01'?'周四':'周三'} · ${list.filter(i=>i.date===date).length} 条</span></header>${list.filter(i=>i.date===date).map(story).join('')}</section>`).join('');}
  function hot(){const matching=daily.filter(i=>filtered().some(f=>f.id===i.id));if(!matching.length)return '';return `<section class="news-hot" aria-label="当前热点"><header><h2>当前热点</h2><span class="meta">按本期收录来源数排列 · 示例</span></header><ol>${matching.sort((a,b)=>b.sources.length-a.sources.length).map((i,n)=>`<li><span class="hot-rank">${n+1}</span>${link(i.id,i.title,'hot-title')}<span class="meta">${i.sources.length} 个来源</span></li>`).join('')}</ol></section>`;}
  function listPage(){return `<section class="news-list-page"><div class="news-top"><nav class="news-modes" aria-label="资讯视图"><button aria-current="page" class="news-mode">精选</button><a class="news-mode" href="#news/daily" data-route="news/daily">AI 日报</a></nav><div class="news-toolbar"><div class="news-filters" aria-label="资讯领域">${['全部',...fields].map(f=>`<button data-news-field="${f}" aria-pressed="${view.field===f}">${f}</button>`).join('')}</div><label class="news-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="news-search" placeholder="搜索标题、摘要…" value="${esc(view.query)}" aria-label="搜索资讯"></label></div><div class="news-subtoolbar"><p>先扫摘要，再点开感兴趣的内容。<a href="#news/daily" data-route="news/daily">当天重点看 AI 日报 →</a></p><button class="section-action" data-news-saved aria-pressed="${view.savedOnly}">已收藏</button></div></div><div id="news-hot">${hot()}</div><div id="news-feed">${feed()}</div><p class="news-end">本期已收录 ${items.length} 个事件 · 新闻、机构与正文均为虚构示例</p></section>`;}
  function sourceMeta(s){return `<dl class="news-source-meta"><dt>来源</dt><dd>${esc(s.name)}</dd><dd class="meta">${esc(s.channel)}</dd><dt>发布时间</dt><dd class="num">${s.published}</dd><dt>保存状态</dt><dd>${s.full?'正文已保留（虚构样例）':'仅摘要 / 链接'}</dd></dl>`;}
  function article(i){
    const s=i.sources[selectedSource]||i.sources[0];
    const full=s.full&&i.sections.length;
    return `<div class="news-reader reading-body"><aside class="reader-left"><a class="reader-back" href="#news" data-route="news">← 返回精选</a><div class="reader-source">${sourceMeta(s)}${i.sources.length>1?`<label for="reader-source-select">同事件来源</label><select class="select" id="reader-source-select">${i.sources.map((s,n)=>`<option value="${n}" ${selectedSource===n?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`:''}</div><details class="reader-toc" open><summary>本文目录</summary><nav aria-label="文章目录">${full?i.sections.map(sec=>`<button data-news-section="article-${sec.id}">${esc(sec.title)}</button>`).join(''):'<span class="meta">本来源未取得正文</span>'}</nav></details></aside><article class="reader-main"><header class="article-heading"><div class="article-kicker">${esc(i.field)} · ${esc(i.kind)}</div><h2>${esc(i.title)}</h2>${i.originalTitle?`<p class="article-original-title">${esc(i.originalTitle)}</p>`:''}<p class="article-demo">虚构新闻样例 · 非真实报道</p></header><section class="article-lead"><h3>AI 导读</h3><p>${esc(i.summary)}</p></section><div class="article-body-label"><span>${full?'正文 · 保留内容样例':'正文暂不可用'}</span><span>${esc(s.name)}</span></div>${full?`<div class="article-prose">${i.sections.map(sec=>`<section id="article-${sec.id}" tabindex="-1"><h3>${esc(sec.title)}</h3>${sec.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}${sec.bullets?`<ul>${sec.bullets.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</section>`).join('')}</div>`:`<section class="article-missing"><h3>这个来源只保留了摘要和链接</h3><p>没有取得可展示的正文，不用 Agent 补写冒充原文。${i.sources.some(s=>s.full)?'可切换上方来源阅读已保留的正文样例。':''}</p></section>`}<section class="reader-bottom"><h3>原始出处</h3>${sourceList(i)}<p class="meta">示例链接：${esc(s.url)}。不跳转虚构外站。</p><a href="#news" data-route="news" class="reader-back">← 返回精选</a></section></article><aside class="reader-right"><div class="reader-actions"><button class="pill" data-source-note>查看原始出处</button>${bookmark(i.id)}</div><section><h3>推荐理由</h3><p>${esc(i.reason)}</p><span class="meta">Agent 判断 · 待自行验证</span></section><section><h3>标签</h3><div class="reader-tags">${i.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div></section>${i.updates.length?`<section><h3>事件进展</h3><ul class="news-updates">${i.updates.map(u=>`<li><time>${u.time}</time><span>${esc(u.text)}</span></li>`).join('')}</ul></section>`:''}</aside></div>`;
  }
  function dailyText(){return dailyBlocks.map(block=>block.text).join('\n\n');}
  function dailyBlock(block){
    const attrs=`data-daily-block="${block.key}"`;
    const text=esc(block.text);
    if(block.type==='brand')return `<span ${attrs}>${text}</span>`;
    if(block.type==='date')return `<time ${attrs}>${text}</time>`;
    if(block.type==='meta')return `<p class="daily-meta" ${attrs}>${text}</p>`;
    if(block.type==='title')return `<h2 ${attrs}>${text}</h2>`;
    if(block.type==='intro')return `<p ${attrs}>${text}</p>`;
    if(block.type==='takeaways-title'||block.type==='section')return `<h3 ${attrs}>${text}</h3>`;
    if(block.type==='takeaway')return `<li ${attrs}>${link(block.itemId,block.text,'daily-link')}</li>`;
    if(block.type==='story-title')return `<h4 ${attrs}>${link(block.itemId,block.text,'daily-link')}</h4>`;
    if(block.type==='footer')return `<footer ${attrs}>${text}</footer>`;
    return `<p class="daily-${block.type}" ${attrs}>${text}</p>`;
  }
  function dailyPage(){
    let body='<header class="daily-masthead">';
    dailyBlocks.forEach(block=>{
      if(block.key==='published')body+='</header><div class="daily-heading">';
      if(block.type==='takeaways-title')body+='</div><section class="daily-takeaways">';
      if(block.key==='takeaway-'+edition.takeaways[0].id)body+='<ol>';
      if(block.type==='section')body+=block.key==='section-0'?'</ol></section><section class="daily-section">':'</section><section class="daily-section">';
      if(block.type==='footer')body+='</section>';
      body+=dailyBlock(block);
    });
    return `<div class="daily-tools"><a class="reader-back" href="#news" data-route="news">← 返回精选</a><span class="meta">固定版本 v2</span><button class="pill" data-copy-daily>复制整期</button><button class="pill" data-print-daily>导出 PDF</button></div><article class="daily-paper">${body}</article><div id="daily-copy-fallback" hidden></div>`;
  }
  function render(id){
    onList=!id;
    if(id==='daily'){activeId='';return dailyPage();}
    if(id){const i=items.find(i=>i.id===id);if(!i)return '<p>这条资讯不存在。<a href="#news" data-route="news">返回精选</a></p>';if(activeId!==id){activeId=id;selectedSource=0;}return article(i);}
    activeId='';return listPage();
  }
  function replaceFeed(){const root=$('#news-feed');if(root)root.innerHTML=feed();const hotRoot=$('#news-hot');if(hotRoot)hotRoot.innerHTML=hot();}
  function currentRoute(){return location.hash.replace(/^#/, '');}
  function click(b){
    if(b.dataset.newsField){view.field=b.dataset.newsField;document.querySelectorAll('[data-news-field]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.newsField===view.field)));replaceFeed();return true;}
    if(b.hasAttribute('data-news-saved')){view.savedOnly=!view.savedOnly;b.setAttribute('aria-pressed',String(view.savedOnly));replaceFeed();return true;}
    if(b.hasAttribute('data-news-reset')){Object.assign(view,{field:'全部',query:'',savedOnly:false,scroll:0});wasList=false;nav('news');return true;}
    if(b.dataset.bookmark){const id=b.dataset.bookmark;if(saved.has(id))saved.delete(id);else saved.add(id);const i=items.find(i=>i.id===id);document.querySelectorAll(`[data-bookmark="${id}"]`).forEach(x=>{x.setAttribute('aria-pressed',String(saved.has(id)));x.setAttribute('aria-label',`${saved.has(id)?'取消收藏':'收藏'}：${i.title}`);x.querySelector('svg').setAttribute('fill',saved.has(id)?'currentColor':'none');});if(view.savedOnly&&onList)replaceFeed();return true;}
    if(b.dataset.newsSection){const target=document.getElementById(b.dataset.newsSection);if(target){window.scrollTo({top:target.getBoundingClientRect().top+window.scrollY-32,behavior:'auto'});target.focus({preventScroll:true});}return true;}
    if(b.hasAttribute('data-source-note')){const target=$('.reader-bottom');window.scrollTo({top:target.getBoundingClientRect().top+window.scrollY-32,behavior:'auto'});return true;}
    if(b.hasAttribute('data-copy-daily')){copyDaily();return true;}
    if(b.hasAttribute('data-print-daily')){window.print();return true;}
    return false;
  }
  async function copyDaily(){const text=dailyText();try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(text);toast('已复制整期虚构日报');}catch{const box=$('#daily-copy-fallback');if(!box)return;box.hidden=false;box.innerHTML=`<p>自动复制不可用，可在下方选择全文复制。</p><textarea class="textarea copy-area" readonly aria-label="整期日报">${esc(text)}</textarea>`;box.querySelector('textarea').select();}}
  function input(e){if(e.id==='news-search'){view.query=e.value;replaceFeed();}if(e.id==='reader-source-select'){selectedSource=Number(e.value);const main=$('#home-content');main.innerHTML=render(activeId);$('#reader-source-select')?.focus({preventScroll:true});}}
  function beforeRender(){if(wasList)view.scroll=window.scrollY;}
  function afterRender(isNews){wasList=isNews&&onList;if(wasList&&view.scroll)window.scrollTo(0,view.scroll);}
  function restoreList(){if(currentRoute()==='news'&&view.scroll)window.scrollTo(0,view.scroll);}
  return{render,click,input,beforeRender,afterRender,restoreList};
};
