(() => {
  if(globalThis.__azcineCollectorLoaded)return;globalThis.__azcineCollectorLoaded=true;
  let host, shadow, target, dragged, groups = [], current = '', hideTimer;
  const send = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.message || '扩展已更新，请刷新网页。'); return result.value; };
  function setup() {
    if (host?.isConnected) return;
    host = document.createElement('div'); shadow = host.attachShadow({mode:'closed'});
    host.style.cssText = 'all:initial;position:fixed;right:24px;top:32%;z-index:2147483647;display:none';
    const style = document.createElement('style'); style.textContent = ':host{font:14px/1.5 system-ui;color:#171717}.drop{box-sizing:border-box;width:252px;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;box-shadow:0 8px 30px #0002;text-align:center}.drop.over{border:2px solid #171717;background:#f3f3f3}strong{display:block;margin-bottom:10px}select{width:100%;padding:8px;background:#fafafa;border:1px solid #ddd;border-radius:6px;color:#171717}p{margin:10px 0 0;font-size:12px;color:#666;overflow-wrap:anywhere}button{margin-top:12px;padding:6px 12px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer}';
    target = document.createElement('div'); target.className = 'drop';
    const title = document.createElement('strong'); title.textContent = '收进 AZCine 灵感库';
    const select = document.createElement('select'); select.setAttribute('aria-label','素材分组'); select.onchange = () => {current=select.value;void send({type:'group',groupId:current}).catch(e=>showResult(e.message,false));};
    const message = document.createElement('p'); message.textContent = '将图片或视频拖到这里';
    target.append(title,select,message); shadow.append(style,target); document.documentElement.append(host);
    target.addEventListener('dragover', e => {if (!dragged) return;e.preventDefault();e.stopPropagation();target.classList.add('over');e.dataTransfer.dropEffect='copy';});
    target.addEventListener('dragleave', () => target.classList.remove('over'));
    target.addEventListener('drop', async e => {
      if (!e.isTrusted || !dragged) return;e.preventDefault();e.stopPropagation();clearTimeout(hideTimer);
      const input = dragged;dragged=null;target.classList.remove('over');message.textContent='正在保存到本机灵感库…';
      try {const value = await send({type:'collect',...input,groupId:current});showResult(value.message,true);}
      catch(error){showResult(error.message,false);}
    });
  }
  function showResult(message,ok){setup();host.style.display='block';target.querySelector('p').textContent=message;target.querySelector('select').hidden=true;clearTimeout(hideTimer);hideTimer=setTimeout(()=>host.style.display='none',ok?4500:9000);}
  document.addEventListener('dragstart', async e => {
    if (!e.isTrusted) return;
    const element=e.composedPath().find(node=>node instanceof Element);const media=element?.closest?.('img,video') || element?.querySelector?.('img,video'); if (!media) return;
    const url=media.currentSrc || media.src;if (!url) return;setup();clearTimeout(hideTimer);
    dragged={id:crypto.randomUUID(),url,name:(media.alt || '').slice(0,180)};host.style.display='block';
    const select=target.querySelector('select');select.hidden=false;select.disabled=true;target.querySelector('p').textContent='正在连接工作台…';
    try {const state=await send({type:'status'});groups=state.groups;current=state.groupId;select.replaceChildren(new Option('未分组',''),...groups.map(g=>new Option(g.name,g.id)));select.value=groups.some(g=>g.id===current)?current:'';current=select.value;select.disabled=false;target.querySelector('p').textContent='松手收集 · 在扩展图标里预选分组';}
    catch(error){target.querySelector('p').textContent=error.message;}
  },true);
  document.addEventListener('dragend',()=>{if(dragged){dragged=null;hideTimer=setTimeout(()=>{if(host)host.style.display='none';},200);}},true);
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.type==='result')showResult(message.message,message.ok);
    if(message.type==='show-collector'){setup();clearTimeout(hideTimer);host.style.display='block';target.querySelector('p').textContent='将网页图片拖到这里；或右键图片选择收进灵感库。';target.querySelector('select').hidden=true;respond({ok:true});}
  });
})();
