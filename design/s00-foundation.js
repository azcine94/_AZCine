(() => {
  const routes = [['today','今天','01'],['projects','项目','02'],['news','资讯','03'],['models','模型榜','04'],['ideas','灵感','05'],['agent','Agent','06'],['jobs','后台任务','07'],['settings','设置','08']];
  const main = document.querySelector('#main');
  const theme = document.querySelector('#theme');
  let selectedTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { selectedTheme = localStorage.getItem('azcine-s00-theme') || selectedTheme; } catch { /* 静态file环境可能不提供存储。 */ }
  const paintTheme = () => { document.documentElement.dataset.theme = selectedTheme; theme.textContent = selectedTheme === 'dark' ? '切换浅色' : '切换深色'; theme.setAttribute('aria-pressed', String(selectedTheme === 'dark')); };
  theme.addEventListener('click', () => { selectedTheme = selectedTheme === 'dark' ? 'light' : 'dark'; paintTheme(); try { localStorage.setItem('azcine-s00-theme', selectedTheme); } catch { theme.title = '本次主题已切换，当前环境无法保存偏好'; } });
  paintTheme();
  document.querySelector('#nav').innerHTML = routes.map(([id,title,glyph]) => `<a class="nav-item" href="#${id}"><span class="nav-glyph" aria-hidden="true">${glyph}</span><span>${title}</span></a>`).join('');
  const empty = (title,copy) => `<div class="foundation-empty"><h2>${title}</h2><p>${copy}</p></div>`;
  const placeholders = {
    projects: '<section class="foundation-section"><h2>公司项目</h2>'+empty('还未接入项目文档','文档、list 和交付汇总将在 S02 接入。')+'</section><section class="foundation-section"><h2>个人项目</h2><p class="subtle">内部功能待定，暂不提供创建操作。</p></section>',
    news: empty('还没有资讯刊期','资讯采集与整理将在 S07 接入，这里不会填充示例新闻。'),
    models: empty('还没有模型榜快照','Arena Text Overall 前 30 名将在 S09 接入，不显示虚构排名。'),
    ideas: empty('灵感记录尚未接入','卡片记录将在 S06 接入。'),
    agent: empty('Pi 尚未接入','独立的原生 Pi 将在 S03 接入；现在不会发送消息或调用模型。'),
    jobs: empty('后台队列尚未接入','本阶段没有运行中的业务任务。关闭桌面窗口即退出，暂不收托盘。'),
  };
  const states = {
    idle: ['还未检查','生产版将调用 Rust 并验证独立临时数据库，不接触业务记录。'],
    loading: ['正在检查','等待桌面响应；检查中不能重复发起。'],
    success: ['桌面连接正常（状态预览）','Rust 往返、临时库写入/读取与事务回滚的结果落点。此处未实际执行。'],
    error: ['连接检查失败（状态预览）','未收到桌面响应。生产版保留错误并可重新检查，不报告成功。'],
  };
  function showState(state) { const box = document.querySelector('#check'); if (!box) return; box.dataset.state=state; box.innerHTML=`<h3>${states[state][0]}</h3><p class="subtle">${states[state][1]}</p>`; }
  function render() {
    const requested = location.hash.slice(1) || 'today';
    const route = routes.find(([id]) => id === requested);
    const id = route?.[0] || 'missing';
    const title = route?.[1] || '页面不存在';
    main.dataset.page = id;
    document.title = `AZCine · ${title} · S00 设计`;
    document.querySelectorAll('#nav a').forEach(a => { if(a.hash === '#'+id) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    let body = placeholders[id] || empty('没有这个页面','请从左侧导航打开页面。');
    if (id === 'today') body = `<div class="today-cards today-cards-b"><section class="today-card review-card"><div class="card-heading"><span class="card-kicker">待核对</span><span class="card-state">未接入</span></div><div class="review-card-body"><h2>还没有可核对的变更</h2><p class="card-description">资料导入后，变更会先放在这里等你核对。</p></div></section><section class="today-card today-tasks-card"><header class="card-heading"><h2>今天要做</h2><span class="card-state">S01 接入</span></header>${empty('从一个待办开始','本阶段还不能保存待办。')}</section><section class="today-card today-delivery-card"><header class="card-heading"><h2>接下来交付</h2><a class="foundation-link" href="#projects">查看项目</a></header>${empty('暂无交付记录','交期将从你指定的项目 list 中汇总。')}</section><section class="today-card today-news-card"><header class="card-heading"><h2>今日资讯</h2><a class="foundation-link" href="#news">查看资讯</a></header>${empty('暂无资讯刊期','真实采集接入后显示，不用示例新闻占位。')}</section></div><div class="foundation-job"><span>后台队列未接入</span><a href="#jobs">查看后台任务</a></div>`;
    if(id === 'settings') body = `<section class="foundation-section"><h2>桌面连接检查</h2><p class="subtle">只检查开发壳与临时数据库，不创建正式数据目录。</p><div id="check" class="foundation-check" role="status" aria-live="polite"></div><details class="foundation-preview"><summary>查看静态设计状态（不执行检查）</summary><div class="preview-actions">${Object.keys(states).map((key,i)=>`<button class="pill" data-state="${key}">${['未检查','检查中','成功落点','失败落点'][i]}</button>`).join('')}</div></details></section>`;
    main.innerHTML = `<header class="page-heading"><div class="page-name"><h1 tabindex="-1">${title}</h1></div><span class="meta">S00 · 空态预览</span></header>${body}`;
    if(id==='settings') {showState('idle'); main.querySelectorAll('button[data-state]').forEach(b=>b.addEventListener('click',()=>showState(b.dataset.state)));}
    main.querySelector('h1').focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',render); render();
})();
