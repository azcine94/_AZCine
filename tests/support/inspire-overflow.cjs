// Keep the original checker and classify only proven, reachable vertical scroll content.
const fs=require('node:fs');
const script=fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
async function inspireOverflow(page) {
  const raw=await page.evaluate(script);
  const evidence=await page.evaluate(()=>{
    const region=document.querySelector('.workspace-scroll'),bounds=region.getBoundingClientRect(),body=document.body.getBoundingClientRect();
    const regionValid=region.getAttribute('role')==='region'&&!!region.getAttribute('aria-label')&&region.tabIndex===0&&getComputedStyle(region).overflowY==='auto'&&bounds.left>=0&&bounds.right<=body.right+2;
    const label=el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
    const text=el=>(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);
    const allowed=[],unreachable=[];
    const controls=[...region.querySelectorAll('button,a,input,textarea,select')].filter(el=>el.checkVisibility({visibilityProperty:true})&&el.getBoundingClientRect().width>0);
    for(const el of controls){
      const rect=el.getBoundingClientRect();
      if(!regionValid||rect.left<bounds.left-2||rect.right>bounds.right+2)continue;
      for(const ancestor of [document.querySelector('#root'),document.querySelector('.app-shell'),document.querySelector('main.workspace')]) {
        const a=ancestor.getBoundingClientRect();
        if(rect.top<a.top-2||rect.bottom>a.bottom+2)allowed.push({kind:'按钮被裁掉',el:label(el),text:text(el),detail:`在 ${label(ancestor)} 里被裁`});
      }
    }
    // Verify each control can actually be revealed by the owned scroll region.
    const prior=region.scrollTop;
    for(const el of controls){el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();if(r.left<bounds.left-2||r.right>bounds.right+2||r.top<bounds.top-2||r.bottom>bounds.bottom+2)unreachable.push({el:label(el),text:text(el),rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}});}
    region.scrollTop=prior;
    return {allowed,unreachable,regionValid,pageFits:document.body.scrollWidth<=innerWidth+2,controls:controls.length};
  });
  const allowed=evidence.allowed.map(issue=>JSON.stringify(issue)),handled=[],unhandled=[];
  for(const issue of raw){const index=allowed.indexOf(JSON.stringify(issue));if(index>=0){allowed.splice(index,1);handled.push(issue);}else unhandled.push(issue);}
  return {raw,handled,unhandled,...evidence,valid:evidence.regionValid&&evidence.pageFits&&evidence.unreachable.length===0&&unhandled.length===0};
}
module.exports={inspireOverflow};
