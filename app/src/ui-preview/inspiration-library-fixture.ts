import { LibraryStore,emptyLibraryState } from '../inspiration-library-client.ts';
import type { LibraryAsset,LibraryGroup,LibraryBridge } from '../inspiration-library-client.ts';
import { uuid } from './data.ts';

// Only virtual media/data. This store never calls IPC, the bridge or a real data root.
export function inspirationFixture(state:string){
  const model=new LibraryStore('');
  const groups:LibraryGroup[]=[{id:uuid(880),name:'场景与氛围',revision:1},{id:uuid(881),name:'建筑空间',revision:1},{id:uuid(882),name:'自然与材质',revision:1}];
  const assets:LibraryAsset[]=Array.from({length:state==='long'?12:6},(_,i)=>({id:uuid(890+i),name:state==='long'?'用于查看长名称换行与截断的虚构素材名称 '.repeat(6):['暮色中的山谷','几何空间','海面光影','林间层次','建筑轮廓','流动的云'][i%6],filename:`fixture-${i}.png`,groupId:groups[i%3].id,kind:'image',mime:'image/png',bytes:128000,hash:'0'.repeat(64),source:'UI 总览 · 虚构素材',sourceUrl:'',createdAt:`2026-10-11T0${i%9}:00:00Z`,tags:['虚构示例','光影'],notes:i===0?[{id:uuid(910),text:'这里的明暗关系值得参考（虚构批注）。',region:{kind:'box',x:.25,y:.25,w:.35,h:.3}}]:[],revision:1}));
  const bridge:LibraryBridge={endpoint:'',token:'',root:'',connected:false};
  model.state={...emptyLibraryState(),assets:['empty','loading'].includes(state)?[]:assets,groups,bridge,loading:state==='loading',error:state==='error'?'虚构：素材目录暂时无法读取，原内容保留。':''};
  model.media=asset=>{
    const i=Number(asset.filename.match(/\d+/)?.[0]??0),colors=[['#223c55','#638d8c'],['#b8cad2','#e4e6e4'],['#19383f','#7caab2'],['#19382a','#668567'],['#615348','#c2b4a0'],['#758b9b','#d9e3e7']][i%6];
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${i%2?640:520}" viewBox="0 0 800 520"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[0]}"/></linearGradient></defs><rect width="800" height="520" fill="url(#g)"/><path d="M0 410 190 130 420 420 610 220 800 400V520H0Z" fill="${colors[0]}"/><circle cx="590" cy="100" r="32" fill="${colors[1]}"/><text x="30" y="485" fill="white" font-size="18">UI 预览 · 虚构素材 ${i+1}</text></svg>`);
  };
  model.start=async()=>{};model.connect=async()=>bridge;model.refresh=async()=>model.put({loading:false,error:''});
  model.save=async asset=>{if(state==='library-save-error')throw new Error('虚构：保存失败，输入保留。');const saved={...model.draft(asset),revision:asset.revision+1};const drafts={...model.state.drafts};delete drafts[asset.id];model.put({assets:model.state.assets.map(a=>a.id===asset.id?saved:a),drafts});return saved;};
  model.group=async(group,remove=false)=>{if(remove&&model.state.assets.some(a=>a.groupId===group.id))throw new Error('分组内还有素材。');model.put({groups:remove?model.state.groups.filter(g=>g.id!==group.id):[...model.state.groups.filter(g=>g.id!==group.id),{...group,revision:group.revision+1}]});};
  model.move=async(ids,groupId)=>model.put({assets:model.state.assets.map(a=>ids.includes(a.id)?{...a,groupId,revision:a.revision+1}:a)});
  model.local=async(asset,operation)=>{if(operation==='delete'){if(state==='library-delete-error')throw new Error('虚构：素材正在使用。');model.put({assets:model.state.assets.filter(a=>a.id!==asset.id)});}else throw new Error('UI 总览不打开真实文件。');};
  model.enqueue=()=>model.put({error:'UI 总览不导入真实文件。'});
  return model;
}
