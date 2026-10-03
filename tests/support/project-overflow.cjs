// Run the unmodified product_6.0 checker. Its global right-edge warning does not
// understand intentional horizontal scrolling; classify only exact warnings
// attributable to a named, keyboard-focusable, in-bounds list scroll region.
const fs=require('node:fs');
const script=fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
async function projectOverflow(page){
  const raw=await page.evaluate(script);
  const boundaries=await page.evaluate(()=>{
    const label=el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
    const text=el=>(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);
    const R=document.body.getBoundingClientRect(),allowed=[],regions=[];
    for(const region of document.querySelectorAll('.list-scroll')){
      const rect=region.getBoundingClientRect(),style=getComputedStyle(region);
      const valid=region.getAttribute('role')==='region'&&!!region.getAttribute('aria-label')&&region.tabIndex===0&&['auto','scroll'].includes(style.overflowX)&&rect.right<=R.right+2&&rect.left>=R.left-2&&rect.width>0;
      regions.push({label:region.getAttribute('aria-label'),valid,client:region.clientWidth,content:region.scrollWidth});
      if(!valid)continue;
      for(const el of region.querySelectorAll('*')){
        const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
        if(cs.display==='none'||cs.visibility==='hidden'||!r.width||!r.height)continue;
        if(r.right>R.right+2)allowed.push({kind:'右边越过容器',el:label(el),text:text(el),detail:`右边 ${Math.round(r.right)} > 容器右边 ${Math.round(R.right)}`});
      }
    }
    return {allowed,regions,pageWidth:document.documentElement.clientWidth,pageContent:document.body.scrollWidth};
  });
  const available=boundaries.allowed.map(issue=>JSON.stringify(issue)),handled=[],unhandled=[];
  for(const issue of raw){const index=available.indexOf(JSON.stringify(issue));if(index>=0){available.splice(index,1);handled.push(issue);}else unhandled.push(issue);}
  return {raw,handled,unhandled,regions:boundaries.regions,pageFits:boundaries.pageContent<=boundaries.pageWidth+2,valid:unhandled.length===0&&boundaries.regions.every(region=>region.valid)&&boundaries.pageContent<=boundaries.pageWidth+2};
}
module.exports={projectOverflow};
