/* Arena public snapshot viewer. No network, live prices, model connection or research store. */
window.createAzModels = function (api) {
  'use strict';
  const {state,esc,icon,nav,refresh}=api;
  const snapshot=window.AZ_MODELS;
  const number=new Intl.NumberFormat('en-US');
  const stamp=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  const price=value=>value===null?'<span class="model-missing" aria-label="来源未提供价格">—</span>':'$'+number.format(value);
  let view='normal',notice='',timer=null;
  function redraw(focus=''){
    if(state.page!=='models')return;
    const scrollY=window.scrollY;refresh();window.scrollTo(0,scrollY);
    if(focus)document.querySelector(focus)?.focus({preventScroll:true});
  }
  function row(model){
    const range=`${Math.round(model.ratingLower)}–${Math.round(model.ratingUpper)}`;
    const uncertainty=Math.round((model.ratingUpper-model.ratingLower)/2);
    return `<tr data-model-rank="${model.rank}"><td class="model-rank num">${String(model.rank).padStart(2,'0')}</td><th scope="row"><span class="model-name">${esc(model.modelDisplayName)}</span><span class="model-lab">${esc(model.modelOrganization||'来源未提供厂商')}${model.releaseType==='pre_release'?'<span class="model-preliminary">初步排名</span>':''}</span></th><td class="model-price num">${price(model.inputPricePerMillion)}</td><td class="model-price num">${price(model.outputPricePerMillion)}</td><td class="model-votes num">${number.format(model.votes)}</td><td class="model-score"><strong class="num">${Math.round(model.rating)}</strong><span class="num" title="来源rating区间 ${esc(range)}">±${uncertainty}</span></td></tr>`;
  }
  function render(){
    const loading=view==='loading';
    const banner=loading?`<div class="model-notice" role="status"><span>检查更新状态预览 · 原快照保留，尚未接入实时抓取。</span><button type="button" id="model-cancel" class="section-action" data-model-cancel>取消</button></div>`:view==='error'?`<div class="model-notice model-notice-error" role="status"><span>未更新：离线设计尚未接入Arena抓取。下方仍是原快照，获取时间未改变。</span><button type="button" class="section-action" data-model-reset>保留原榜</button></div>`:notice?`<p class="model-notice" role="status">${esc(notice)}</p>`:'';
    return `<section class="model-board"><header class="model-board-heading"><div><h2>Arena · 文本综合榜</h2><p class="model-snapshot-meta">前 30 名 · ${number.format(snapshot.totalModels)} 个模型参与排名 · 公开离线快照</p><p class="model-snapshot-time">数据截止 <time datetime="${esc(snapshot.voteCutoff)}">${stamp(snapshot.voteCutoff)}</time> · 获取 <time datetime="${esc(snapshot.capturedAt)}">${stamp(snapshot.capturedAt)}</time>（北京时间）</p></div><div class="model-board-actions"><a class="section-action" href="${esc(snapshot.sourceUrl)}" target="_blank" rel="noopener noreferrer">Arena 原榜 ${icon('arrow')}</a><button type="button" id="model-update" class="pill" data-model-update ${loading?'disabled':''}>${loading?'检查中…':'检查更新'}</button></div></header><div class="model-board-tools"><span class="model-category">Text Overall</span><span>Style Control · 官方默认</span><span>价格：USD / 1M tokens</span><details class="model-explanation"><summary>怎么读这个榜？</summary><div><p>按Arena Text Overall公开快照原序列出前30行。综合文本任务包括问答、推理、写作和部分编程；不是Code WebDev专榜，也不代表所有任务的绝对能力。</p><p>分数保留Arena原始rating尺度并四舍五入显示，不转成百分制。±为来源rating区间的半宽，初步排名来自来源Preliminary标识。票数是Arena投票数，不是独立评测项目数量。</p><p>输入/输出价来自同一Arena快照，单位为美元/百万tokens；“—”表示来源没有价格，不是免费，亦不等于你的反代实际收费。来源未提供的上线日期和缓存价不展示。</p><p>当前是可追溯离线快照。“检查更新”只演示加载与未接入状态，不请求网络、不改获取时间。需要最新数据可打开Arena原榜。</p></div></details></div>${banner}${view==='empty'?`<div class="model-empty"><h3>还没有可用的榜单快照</h3><p>空状态预览，不编造模型或排名。</p><button type="button" class="pill on" data-model-reset>返回已保存快照</button><a class="section-action" href="${esc(snapshot.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看 Arena 原榜 ${icon('arrow')}</a></div>`:`<div class="model-table-scroll" tabindex="0" aria-label="Arena前30模型榜，窄窗口可横向滚动"><table class="model-table"><colgroup><col class="model-col-rank"><col class="model-col-name"><col class="model-col-price"><col class="model-col-price"><col class="model-col-votes"><col class="model-col-score"></colgroup><thead><tr><th scope="col">排名</th><th scope="col">模型</th><th scope="col">输入价</th><th scope="col">输出价</th><th scope="col">票数</th><th scope="col">分数 ↓</th></tr></thead><tbody>${snapshot.rows.map(row).join('')}</tbody></table></div><footer class="model-board-footer">以上为 ${stamp(snapshot.voteCutoff)} 截止的 Text Overall 前30行 · ${number.format(snapshot.totalVotes)} 票（全榜） · 不跨榜比较分数。</footer>`}</section>`;
  }
  function click(button){
    if(button.dataset.modelPreview){clearTimeout(timer);timer=null;view=button.dataset.modelPreview;notice='';nav('models');return true;}
    if(button.hasAttribute('data-model-reset')){clearTimeout(timer);timer=null;view='normal';notice='';redraw('#model-update');return true;}
    if(button.hasAttribute('data-model-cancel')){clearTimeout(timer);timer=null;view='normal';notice='已取消检查演示 · 原快照与获取时间不变。';redraw('#model-update');return true;}
    if(button.hasAttribute('data-model-update')){
      if(view==='loading')return true;
      view='loading';notice='';redraw('#model-cancel');
      // Only a disclosed loading→not-integrated preview, never a simulated successful GET.
      timer=setTimeout(()=>{timer=null;view='error';redraw('#model-update');},700);
      return true;
    }
    return false;
  }
  return {render,click};
};
