// The vault path is an identity; each row displays only its own basename.
type FileEntry={path:string;id:string;name:string;search:string;active:boolean;dirty:boolean;attachment?:boolean};
type Folder={path:string;name:string;folders:Map<string,Folder>;files:FileEntry[]};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const compare=(a:{name:string},b:{name:string})=>a.name.localeCompare(b.name,'zh-CN',{numeric:true});
export function createVaultTree(container:HTMLElement){
  const expanded=new Set<string>();
  let lastHTML='',lastDirectories:string[]=[],lastFiles:FileEntry[]=[],lastQuery='';
  container.addEventListener('click',event=>{
    const summary=(event.target as HTMLElement).closest<HTMLElement>('summary[data-folder-path]');if(!summary)return;
    event.preventDefault();const path=summary.dataset.folderPath!;
    if(expanded.has(path))expanded.delete(path);else expanded.add(path);
    render(lastDirectories,lastFiles,lastQuery);
    Array.from(container.querySelectorAll<HTMLElement>('summary')).find(el=>el.dataset.folderPath===path)?.focus({preventScroll:true});
  });
  function render(directories:string[],files:FileEntry[],query:string){
    lastDirectories=directories;lastFiles=files;lastQuery=query;
    const root:Folder={path:'',name:'',folders:new Map(),files:[]};
    function folder(path:string){let node=root;let full='';for(const part of path.split('/').filter(Boolean)){full=full?`${full}/${part}`:part;let child=node.folders.get(part);if(!child){child={path:full,name:part,folders:new Map(),files:[]};node.folders.set(part,child);}node=child;}return node;}
    for(const path of directories)folder(path);
    for(const file of files){if(query&&!file.search.toLowerCase().includes(query))continue;const slash=file.path.lastIndexOf('/');folder(slash<0?'':file.path.slice(0,slash)).files.push(file);}
    function contents(node:Folder):string{
      const groups=Array.from(node.folders.values()).sort(compare).map(child=>{
        const body=contents(child);if(query&&!body&&!child.path.toLowerCase().includes(query))return '';
        return `<details class="tree-folder" ${expanded.has(child.path)?'open':''}><summary class="ui-disclosure" data-folder-path="${escape(child.path)}" title="${escape(child.path)}"><span class="folder-name">${escape(child.name)}</span></summary><div class="tree-children">${body}</div></details>`;
      }).join('');
      return groups+node.files.sort(compare).map(file=>`<button class="ui-button ui-menu-item" ${file.attachment?`data-attachment="${escape(file.path)}"`:`data-note="${escape(file.id)}"`} title="${escape(file.path)}" aria-pressed="${file.active}"><span class="file-icon" aria-hidden="true">${file.attachment?'⌑':'▤'}</span><span class="file-name">${escape(file.name)}</span>${file.dirty?'<span class="dirty-dot" aria-label="页面有修改">●</span>':''}</button>`).join('');
    }
    const html=contents(root)||'<p class="t2 s" style="padding:16px">没有匹配的文件</p>';
    // Polling and edits must not replace unchanged DOM or steal tree focus.
    if(html!==lastHTML){const active=document.activeElement as HTMLElement|null;const key=active?.closest<HTMLElement>('summary[data-folder-path]')?.dataset.folderPath;const note=active?.dataset.note;const scroll=container.scrollTop;container.innerHTML=html;lastHTML=html;container.scrollTop=scroll;if(key)Array.from(container.querySelectorAll<HTMLElement>('summary')).find(el=>el.dataset.folderPath===key)?.focus({preventScroll:true});if(note)Array.from(container.querySelectorAll<HTMLElement>('[data-note]')).find(el=>el.dataset.note===note)?.focus({preventScroll:true});}
  }
  return {render,reveal(path:string){const parts=path.split('/');for(let i=1;i<parts.length;i++)expanded.add(parts.slice(0,i).join('/'));lastHTML='';}};
}
