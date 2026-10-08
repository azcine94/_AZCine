(() => {
  try {
    if (document.readyState !== 'complete') return null;
    const visible = el => { const s = getComputedStyle(el); return !el.hidden && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
    const text = document.body?.innerText || '';
    if (/please enable js|verify you are human|checking your browser|subscribe to continue|subscribe to read|sign in to continue|already a subscriber|订阅后阅读/i.test(text)) return {blocked:true};
    const selectors = ['[itemprop="articleBody"]','.entry-content','.wp-block-post-content','.ArticleBody-articleBody','.article-body','.article__body','.article-content','.post-content','.story-body','.entryPage','article','main'];
    let node;
    for (const selector of selectors) {node = [...document.querySelectorAll(selector)].filter(visible).sort((a,b)=>b.innerText.length-a.innerText.length)[0];if(node?.innerText.trim().length >= 200) break;node=null;}
    if (!node) return null;
    const copy = node.cloneNode(true);
    const originals = [node,...node.querySelectorAll('*')], clones = [copy,...copy.querySelectorAll('*')];
    for(let i=originals.length-1;i>0;i--){const el=originals[i],cl=clones[i];if(!visible(el)||el.matches('script,style,noscript,template,nav,footer,form,iframe,aside,[role="navigation"],[aria-hidden="true"]')){cl.remove();continue;}if(el.tagName==='IMG'){cl.setAttribute('src',el.currentSrc||el.src);}if(el.tagName==='A')cl.setAttribute('href',el.href);}
    const url = new URL(location.href);url.hash='';
    return {url:url.href,html:'<article>'+copy.innerHTML+'</article>'};
  }catch{return null;}
})()
