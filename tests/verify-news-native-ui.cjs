// Actual owned Windows/WebView2 window; no IPC or UI fixtures in this validator.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./support/browser.cjs').browserRuntime();const{validationRun}=require('./support/validation-run.cjs');
(async()=>{const owner=Number(process.argv[2]);if(!Number.isInteger(owner)||owner<=0)throw Error('Explicit owned desktop PID required');
 const executable=path.resolve('app/src-tauri/target/debug/azcine.exe');const actual=execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${owner}).Path`],{encoding:'utf8'}).trim();if(actual.toLowerCase()!==executable.toLowerCase())throw Error('PID is outside this worktree');
 const{out,hashes}=validationRun('news-native-ui',['app/src','app/src-tauri/src','scripts','tests/verify-news-native-ui.cjs']);const report={mode:'real owned Windows WebView2 window, synthetic stored data; no IPC replay',owner,before:hashes(),checks:[],errors:[]};const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};let browser,page;
 try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+(process.env.AZCINE_CDP_PORT||9226));page=browser.contexts()[0].pages().find(p=>new URL(p.url()).origin==='http://127.0.0.1:'+(process.env.AZCINE_WEB_PORT||1421));if(!page)throw Error('Owned main view unavailable');page.on('pageerror',e=>report.errors.push(e.message));
  const snapshot=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('news_editorial_snapshot'));if(!snapshot.events.length)throw Error('Run real desktop validation first');const event=snapshot.events[0].id;
  for(const theme of ['light','dark'])for(const[width,height]of [[1440,900],[1280,800],[1024,768]]){
   execFileSync('powershell.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(owner),'-Action','resize','-Width',String(width),'-Height',String(height)],{stdio:'pipe'});await page.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[width,height]);
   if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
   for(const[route,name]of [['news','reading'],['news/events/'+event,'article'],['settings/news','sources'],['settings/news/rules','rules']]){
    await page.evaluate(h=>location.hash=h,route);await page.waitForTimeout(100);if(name==='reading')await page.getByRole('button',{name:'精选',exact:true}).click();await page.locator('.workspace-scroll').evaluate(e=>e.scrollTo(0,0));
    const bounds=await page.evaluate(()=>{const e=document.querySelector('.workspace-scroll');return{w:innerWidth,h:innerHeight,document:document.documentElement.scrollWidth,content:e.scrollWidth,container:e.clientWidth};});check(`桌面无溢出 ${theme} ${width}x${height} ${name}`,bounds.w===width&&bounds.h===height&&bounds.document<=width+1&&bounds.content<=bounds.container+1,bounds);
    if(name==='sources'&&width===1024){const box=await page.locator('.news-table-caption').boundingBox();check(`窄窗口信源标题横排 ${theme}`,box.width>200&&box.height<40,box);}
    if(name==='reading'){
     const ratios=await page.evaluate(()=>{const linear=x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4;const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(linear);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};return ['.news-summary','.news-entry-source','.news-reason'].map(selector=>{const e=document.querySelector(selector);const fg=luminance(getComputedStyle(e).color),bg=luminance(getComputedStyle(e.closest('.news-entry')).backgroundColor);return{selector,ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});});check(`正文辅助文字对比度 ${theme} ${width}`,ratios.every(r=>r.ratio>=4.5),ratios);
    }
    await page.screenshot({path:path.join(out,`${name}-${theme}-${width}x${height}.png`)});
   }
  }
  await page.evaluate(()=>location.hash='news');await page.getByRole('button',{name:'精选',exact:true}).focus();await page.keyboard.press('Tab');check('真实桌面键盘焦点可见',await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return e.textContent==='全部动态'&&e.matches(':focus-visible')&&parseFloat(s.outlineWidth)>=2;}));await page.keyboard.press('Enter');check('真实桌面键盘切换页签',await page.getByRole('button',{name:'全部动态',exact:true}).getAttribute('aria-pressed')==='true');
  execFileSync('powershell.exe',['-NoProfile','-File','tests/support/capture-native-window.ps1','-OwnerPid',String(owner),'-Output',path.join(out,'native-frame-dark-1024.png')],{stdio:'pipe'});
  report.after=hashes();check('源码稳定',JSON.stringify(report.before)===JSON.stringify(report.after));check('无WebView2页面异常',report.errors.length===0);
 }catch(e){report.failure=String(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));}
})().catch(e=>{console.error(e);process.exitCode=1;});
