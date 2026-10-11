const MAX_BYTES = 256 * 1024 * 1024;
let connection, busy = false;
async function config() {
  if (!connection) connection = await (await fetch(chrome.runtime.getURL('connection.json'), {cache: 'no-store'})).json();
  return connection;
}
async function connect() {
  const cfg = await config();
  const endpoints = [cfg.endpoint, ...Array.from({length:20}, (_,i) => 'http://127.0.0.1:' + (41570+i))];
  for (const endpoint of [...new Set(endpoints)]) {
    try {
      const response = await fetch(endpoint + '/status', {method:'POST',headers: {'X-Azcine-Token': cfg.token}, signal: AbortSignal.timeout(1200)});
      if (!response.ok) continue;
      const state = await response.json();
      if (state.app !== 'AZCine' || state.version !== 1) continue;
      cfg.endpoint = endpoint; return state;
    } catch { /* Only try the application's fixed loopback port range. */ }
  }
  throw new Error('未连接到对应的 AZCine 数据库。请打开桌面工作台；更换数据根后需重新准备并重新加载扩展。');
}
async function status() {
  const state = await connect(); const saved = await chrome.storage.local.get(['groupId','lastResult']);
  return {...state, groupId: saved.groupId || '', lastResult: saved.lastResult || null};
}
function sourceUrl(value) {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('此素材没有可下载的 HTTP/HTTPS 地址。流媒体视频请先下载为文件，再导入工作台。');
  return url.href;
}
async function collect(input) {
  if (busy) throw new Error('正在收集上一份素材，请稍候再拖入。');
  busy = true;
  const requestId = input.id || crypto.randomUUID();
  try {
    await connect(); const cfg = await config();
    const saved = await chrome.storage.local.get('groupId');
    const remote = sourceUrl(input.url), page = sourceUrl(input.pageUrl || input.url);
    await chrome.action.setBadgeText({text: '…'});
    const response = await fetch(remote, {credentials: 'omit', signal: AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error('网站拒绝下载素材（' + response.status + '），可保存到本机后导入。');
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('视频最多256MiB，图片最多50MiB。');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('素材超过256MiB。'); }
      chunks.push(value);
    }
    const file = new Blob(chunks, {type:response.headers.get('content-type') || 'application/octet-stream'});
    const filename = (input.name || new URL(remote).pathname.split('/').pop() || '网页素材').slice(0,180);
    const meta = {id:requestId, name:filename, groupId:input.groupId ?? saved.groupId ?? '', source:'Chrome · ' + new URL(page).hostname, sourceUrl:page};
    const result = await fetch(cfg.endpoint + '/import', {method:'POST', headers:{'X-Azcine-Token':cfg.token,'X-Azcine-Meta':encodeURIComponent(JSON.stringify(meta)),'Content-Type':'application/octet-stream'}, body:file, signal:AbortSignal.timeout(180000)});
    const asset = await result.json(); if (!result.ok) throw new Error(asset.message || '写入灵感库失败。');
    const receipt = {ok:true, message:'已收进灵感库：' + asset.name, at:Date.now()};
    await chrome.storage.local.set({lastResult:receipt}); await chrome.action.setBadgeText({text:'✓'}); return receipt;
  } catch (error) {
    const receipt = {ok:false, message:error.message || '采集失败，请重试。', at:Date.now()};
    await chrome.storage.local.set({lastResult:receipt}); await chrome.action.setBadgeText({text:'!'}); throw error;
  } finally { busy = false; }
}
chrome.runtime.onInstalled.addListener(() => {
  // Existing pages do not receive newly installed content scripts automatically.
  void chrome.tabs.query({url:['http://*/*','https://*/*']}).then(tabs=>Promise.allSettled(tabs.filter(tab=>tab.id).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']}))));
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({id:'azcine-collect', title:'收进 AZCine 灵感库', contexts:['image','video']}));
  chrome.alarms.create('azcine-connection', {periodInMinutes:1});
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'azcine-connection') void connect().catch(() => {}); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'azcine-collect' || !info.srcUrl) return;
  void collect({url:info.srcUrl,pageUrl:info.pageUrl || tab?.url}).then(result => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id,{type:'result',...result}).catch(() => {});
  }).catch(error => {if (tab?.id) chrome.tabs.sendMessage(tab.id,{type:'result',ok:false,message:error.message}).catch(() => {});});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  let task;
  if (message.type === 'status') task = status();
  else if (message.type === 'group') task = chrome.storage.local.set({groupId:String(message.groupId || '')});
  else if (message.type === 'collect' && sender.tab) task = collect({...message, pageUrl:sender.url || sender.tab.url});
  else return;
  Promise.resolve(task).then(value => respond({ok:true,value}), error => respond({ok:false,message:error.message || '连接失败'}));
  return true;
});
