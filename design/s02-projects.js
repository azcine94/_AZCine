// Design-only in-memory illustration, not the production document or persistence model.
const content = document.querySelector('#content');
const heading = document.querySelector('h1');
const status = document.querySelector('.status-line');
let mode = 'saved';
const state = { stage: 'ACOPY', date: '2027-01-05', delivered: false, included: true, present: true };
function feedback(message, kind = 'saved') { status.textContent = message; status.dataset.kind = kind; }
function summary() {
  const shown = state.included && state.present && !state.delivered;
  document.querySelectorAll('[data-summary-date]').forEach(e => { e.textContent = shown ? state.date || '日期待补' : '暂无待交'; });
  document.querySelectorAll('[data-summary-stage]').forEach(e => { e.textContent = shown ? `SH010 · ${state.stage || '阶段待补'}` : '仅统计指定 list 中未交完的镜头'; });
}
function render() {
  const documentPage = location.hash === '#document';
  document.querySelector('main').dataset.page = documentPage ? 'document' : 'projects';
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === location.hash || !location.hash && a.hash === '#projects') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  heading.textContent = documentPage ? '雾港 · 公司文档' : '项目';
  content.innerHTML = documentPage ? `<div class="project-content">
    <div class="document-top"><a class="pill" href="#projects">返回项目</a><label for="project-title">项目名称</label><input class="input" id="project-title" value="雾港"><button class="pill" data-action="save">保存名称</button></div>
    <section class="delivery-summary" aria-label="交付摘要"><div class="summary-feature"><p>最近交付</p><p class="project-date" data-summary-date></p><p class="meta" data-summary-stage></p></div><div class="summary-items"><h2>待交镜头</h2><a class="pill" href="#row-sh010" id="go-row">回到 SH010 原行</a><p class="subtle">以当前日期和阶段汇总，FINAL 不代表交完。</p></div></section>
    <section class="doc-block"><div class="block-heading"><h2>项目笔记</h2><button class="pill" data-action="move">下移</button><button class="pill" data-action="remove-block">移除块</button></div><label for="note" class="meta">文字内容</label><textarea class="textarea doc-text" id="note">这里自由记录工作要求。原资料若有多个阶段日期，在导入核对时原样保留，不自动挑选。</textarea></section>
    <section class="doc-block"><div class="block-heading"><h2>镜头清单</h2><label class="check-label"><input type="checkbox" id="include" ${state.included ? 'checked' : ''}>参与交付汇总</label><button class="pill" data-action="columns">管理列</button></div>
      <div class="list-scroll" role="region" aria-label="镜头清单，可横向滚动" tabindex="0"><table class="doc-table"><thead><tr><th>镜头</th><th>当前阶段</th><th>当前交期</th><th>交付状态</th><th>操作</th></tr></thead><tbody id="rows"><tr id="row-sh010" tabindex="-1"><td><input class="input shot" aria-label="镜头名称" value="SH010"></td><td><button class="pill stage-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="stage-options" id="stage">${state.stage}</button><div class="stage-options" role="listbox" aria-label="当前阶段" id="stage-options" hidden>${['ACOPY','FINAL','客户补充后的较长阶段标签'].map(name => `<button role="option" aria-selected="${state.stage === name}" data-stage="${name}">${name}</button>`).join('')}</div></td><td><input class="input" type="date" aria-label="当前交期" id="date" value="${state.date}"></td><td><label class="check-label"><input type="checkbox" id="delivered" ${state.delivered ? 'checked' : ''}>已交完</label></td><td><button class="pill" data-action="remove-row">删除行</button></td></tr></tbody></table></div>
      <div class="form-actions"><button class="pill" data-action="add-row">添加行</button><button class="pill" data-action="undo">撤销删除</button></div>
      <details class="tag-settings"><summary>管理项目标签</summary><p class="meta">仅影响雾港，其他项目保持独立。</p><div class="tag-row"><label for="label-name">标签名称</label><input class="input" id="label-name" value="ACOPY"><button class="pill" data-action="rename-tag">改名</button><button class="pill" data-action="remove-tag">删除</button></div><div class="form-actions"><button class="pill" data-action="add-tag">新增标签</button></div></details>
    </section><section class="doc-block"><h2>勾选清单</h2><label class="check-label"><input type="checkbox">核对参考版本</label></section><div class="form-actions"><button class="pill" data-action="text">添加文字</button><button class="pill" data-action="list">添加 list</button><button class="pill" data-action="checklist">添加勾选清单</button></div><p class="meta">资料导入在 S05 接入；此处不提供假解析。</p></div>` : `<div class="project-content"><section><h2>公司项目</h2><form class="entry-form project-create"><label for="new-project">新项目名称</label><input id="new-project" placeholder="例如：雾港"><button class="pill on">新建公司项目</button></form><div class="project-grid"><a class="project-card" href="#document"><span class="meta">公司文档</span><h2>雾港</h2><span class="project-date" data-summary-date></span><span data-summary-stage></span></a><a class="project-card" href="#document"><span class="meta">公司文档 · 虚构空项目</span><h2>远山</h2><span>尚未指定交付 list</span></a></div></section><section class="doc-block"><h2>个人项目</h2><p class="subtle">内部功能待定，暂不提供创建操作。</p></section></div>`;
  if (mode === 'empty') {
    if (documentPage) {
      content.querySelectorAll('.doc-block,.delivery-summary').forEach(e => { e.hidden = true; });
      const empty = document.createElement('p'); empty.className = 'doc-block'; empty.textContent = '文档还是空的，从添加文字或 list 开始。';
      content.querySelector('.document-top').after(empty);
    } else content.querySelector('.project-grid').innerHTML = '<p class="subtle">还没有公司项目，先填写一个项目名称。</p>';
  }
  if (mode === 'loading') content.querySelectorAll('input,textarea,button').forEach(e => { e.disabled = true; });
  summary();
  heading.focus();
  if (mode === 'empty') feedback('空文档：还没有内容，可以从添加文字或 list 开始。');
  else if (mode === 'loading') feedback('正在读取，现有内容保留；不报告保存成功。');
  else if (mode === 'error') feedback('保存失败：输入已保留，请检查目录空间与权限后重试。', 'error');
  else if (mode === 'conflict') feedback('删除后内容已变化，不能直接撤销覆盖。原数据仍保留，请重新核对。', 'conflict');
  else feedback('设计预览 · 仅本次页面内存，不代表已经落盘。');
}
function closeStage() { const options = document.querySelector('#stage-options'); if (options) options.hidden = true; document.querySelector('#stage')?.setAttribute('aria-expanded','false'); }
document.addEventListener('click', event => {
  const target = event.target.closest('button,a'); if (!target) return;
  if (target.id === 'theme') { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; target.textContent = dark ? '切换浅色' : '切换深色'; return; }
  if (target.dataset.state) { mode = target.dataset.state; render(); return; }
  if (target.id === 'go-row') { event.preventDefault(); document.querySelector('#row-sh010')?.focus(); return; }
  if (target.id === 'stage') { const options = document.querySelector('#stage-options'); options.hidden = !options.hidden; target.setAttribute('aria-expanded',String(!options.hidden)); if (!options.hidden) options.querySelector('[aria-selected="true"]')?.focus(); return; }
  if (target.dataset.stage) { state.stage = target.dataset.stage; document.querySelector('#stage').textContent = state.stage; document.querySelectorAll('[data-stage]').forEach(e => e.setAttribute('aria-selected',String(e.dataset.stage === state.stage))); closeStage(); document.querySelector('#stage').focus(); summary(); feedback('阶段已切换（设计预览），当前日期、行 ID 与交完状态不变。'); return; }
  if (target.dataset.action === 'remove-tag') { feedback('此标签仍被镜头引用，请先切换引用后再删除。', 'error'); return; }
  if (target.dataset.action === 'remove-row') { state.present = false; document.querySelector('#row-sh010').hidden = true; summary(); feedback('已删除一行（设计预览），可以撤销。'); return; }
  if (target.dataset.action === 'undo') { if (mode === 'conflict') { feedback('删除后的基线已变，未覆盖新的编辑。', 'conflict'); return; } state.present = true; document.querySelector('#row-sh010').hidden = false; summary(); feedback('已恢复原行及标签、日期（设计预览）。'); return; }
  if (target.dataset.action) feedback('此动作的正式保存将在 S02 实现；这里仅检查状态与布局。');
});
document.addEventListener('change', event => { if (event.target.id === 'date') state.date = event.target.value; if (event.target.id === 'include') state.included = event.target.checked; if (event.target.id === 'delivered') state.delivered = event.target.checked; summary(); });
document.addEventListener('keydown', event => { const options = document.querySelector('#stage-options'); if (!options || options.hidden) return; const buttons = [...options.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); if (event.key === 'Escape') { event.preventDefault(); closeStage(); document.querySelector('#stage').focus(); } else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(event.key === 'ArrowDown' ? 1 : -1)+buttons.length)%buttons.length; buttons[next].focus(); } });
document.addEventListener('submit', event => { event.preventDefault(); feedback(document.querySelector('#new-project')?.value.trim() ? '设计预览不会创建真实项目。' : '请填写项目名称，输入已保留。', 'error'); });
window.addEventListener('hashchange',render); render();
