import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from './desktop-api.ts';
import { asItem, collectGoodcase, fetchRanking, fetchGoodcaseDetail, fetchGoodcaseRetests } from './goodcase-source.ts';
import type { GoodcaseCategory, GoodcaseSort, GoodcaseView, GoodcaseSnapshot, GoodcaseSnapshotEntry, GoodcaseRanking, GoodcaseItem, GoodcaseRetests } from './goodcase-types.ts';
export interface GoodcaseFavorites {revision:number;items:GoodcaseItem[]}
export interface GoodcaseBackend {
  collect:()=>Promise<GoodcaseSnapshot>;
  ranking:(c:GoodcaseCategory,s:GoodcaseSort,p:number)=>Promise<GoodcaseRanking>;
  detail:(slug:string,force?:boolean)=>Promise<GoodcaseItem>;
  retests:(slug:string)=>Promise<GoodcaseRetests>;
  favorites:()=>Promise<GoodcaseFavorites>;
  save:(item:GoodcaseItem,saved:boolean,revision:number)=>Promise<GoodcaseFavorites>;
  history:()=>Promise<GoodcaseSnapshotEntry[]>;
  readSnapshot:(id:string)=>Promise<GoodcaseSnapshot>;
  saveSnapshot:(snapshot:GoodcaseSnapshot)=>Promise<GoodcaseSnapshotEntry>;
}
export interface RankingState extends GoodcaseRanking {pending:boolean;error:string}
export interface GoodcaseState {
  category:GoodcaseCategory;view:GoodcaseView;sort:GoodcaseSort|'overview';query:string;
  snapshot:GoodcaseSnapshot|null;refreshing:boolean;error:string;rankings:Record<string,RankingState>;
  items:Record<string,GoodcaseItem>;detailLoaded:Record<string,boolean>;detailPending:Record<string,boolean>;detailErrors:Record<string,string>;
  retests:Record<string,GoodcaseRetests>;retestPending:Record<string,boolean>;retestErrors:Record<string,string>;
  favorites:GoodcaseFavorites;favoritesLoaded:boolean;favoritesPending:boolean;favoriteSaving:boolean;favoritesError:string;
  history:GoodcaseSnapshotEntry[];historyPending:boolean;historyError:string;restoring:boolean;selectedSnapshotId:string;
}
type ContentState=Pick<GoodcaseState,'snapshot'|'rankings'|'items'|'detailLoaded'|'retests'>;
function message(error:unknown){
  const detail=typeof error==='string'?error.trim():error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message.trim():'';
  if(/goodcase[_-].*(?:not allowed|not found|denied)|(?:not allowed|not found|denied).*goodcase[_-]/i.test(detail))return 'AI 作品接口未启用，请重启桌面开发程序后重试。';
  return detail||'读取失败，请稍后重试。';
}
export class GoodcaseStore {
  private listeners=new Set<()=>void>();private started=false;private generation=0;
  private liveContent:ContentState|null=null;
  readonly scrollPositions=new Map<string,number>();
  state:GoodcaseState={category:'video',view:'rankings',sort:'heat',query:'',snapshot:null,refreshing:false,error:'',rankings:{},items:{},detailLoaded:{},detailPending:{},detailErrors:{},retests:{},retestPending:{},retestErrors:{},favorites:{revision:0,items:[]},favoritesLoaded:false,favoritesPending:false,favoriteSaving:false,favoritesError:'',history:[],historyPending:false,historyError:'',restoring:false,selectedSnapshotId:''};
  readonly backend:GoodcaseBackend;
  constructor(backend:GoodcaseBackend){this.backend=backend;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  getSnapshot=()=>this.state;
  patch=(value:Partial<GoodcaseState>)=>{this.state={...this.state,...value};this.listeners.forEach(fn=>fn());};
  start=()=>{if(this.started)return;this.started=true;void this.initialize();void this.loadFavorites();};
  private async initialize(){
    this.patch({restoring:true,historyError:''});
    try{
      const history=await this.backend.history();this.patch({history});
      if(history[0])this.showSnapshot(await this.backend.readSnapshot(history[0].id));
    }catch(error){this.patch({historyError:`本地快照恢复失败。${message(error)}`});}
    finally{this.patch({restoring:false});}
    await this.refresh();
  }
  private showSnapshot(snapshot:GoodcaseSnapshot){
    const rankings:Record<string,RankingState>={};
    for(const [category,sorts] of Object.entries(snapshot.rankings))for(const [sort,page] of Object.entries(sorts))rankings[`${category}:${sort}`]={...page,pending:false,error:''};
    this.generation++;
    this.patch({snapshot,rankings,items:Object.fromEntries(snapshot.cases.map(x=>[x.slug,x])),detailLoaded:{},detailPending:{},detailErrors:{},retests:{},retestPending:{},retestErrors:{}});
  }
  async selectSnapshot(id:string){
    if(this.state.restoring||this.state.refreshing||this.state.historyPending||id===this.state.selectedSnapshotId)return;
    this.patch({historyPending:true,historyError:''});
    try{
      if(!id&&this.liveContent){
        this.generation++;this.patch({...this.liveContent,selectedSnapshotId:'',detailPending:{},detailErrors:{},retestPending:{},retestErrors:{}});this.liveContent=null;
      }else{
        const snapshot=await this.backend.readSnapshot(id||this.state.history[0]?.id||'');
        if(!this.state.selectedSnapshotId){const {snapshot,rankings,items,detailLoaded,retests}=this.state;this.liveContent={snapshot,rankings:Object.fromEntries(Object.entries(rankings).map(([key,page])=>[key,{...page,pending:false}])),items,detailLoaded,retests};}
        this.showSnapshot(snapshot);this.patch({selectedSnapshotId:id});
      }
    }catch(error){this.patch({historyError:`快照读取失败，当前内容保留。${message(error)}`});}
    finally{this.patch({historyPending:false});}
  }
  navigate=(value:Partial<Pick<GoodcaseState,'category'|'view'|'sort'|'query'>>)=>this.patch(value);
  private merge(items:GoodcaseItem[]){const merged={...this.state.items};for(const x of items)merged[x.slug]=this.state.detailLoaded[x.slug]?{...x,...merged[x.slug]}:{...merged[x.slug],...x};return merged;}
  async refresh(){
    if(this.state.refreshing||this.state.restoring||this.state.historyPending)return;
    this.patch({refreshing:true,error:''});
    try{
      const snapshot=await this.backend.collect();
      this.showSnapshot(snapshot);this.liveContent=null;this.scrollPositions.clear();this.patch({selectedSnapshotId:''});
      try{
        const saved=await this.backend.saveSnapshot(snapshot);
        this.patch({history:[saved,...this.state.history],historyError:''});
      }catch(error){this.patch({historyError:`本次作品已读取，但快照未能保存。${message(error)}`});}
    }catch(error){this.patch({error:message(error)});}
    finally{this.patch({refreshing:false});}
  }
  async loadNext(category=this.state.category,sort=this.state.sort){
    if(sort==='overview'||this.state.refreshing||this.state.restoring||this.state.historyPending||this.state.selectedSnapshotId)return;
    const key=`${category}:${sort}`,old=this.state.rankings[key];
    if(!old||old.pending||!old.hasMore)return;
    const generation=this.generation;
    this.patch({rankings:{...this.state.rankings,[key]:{...old,pending:true,error:''}}});
    try{
      const page=await this.backend.ranking(category,sort,old.page+1);
      if(generation!==this.generation)return;
      if(page.page!==old.page+1||page.category!==category||page.sort!==sort)throw Error('来源返回了其他榜单，已保留当前作品。');
      const seen=new Set(old.items.map(x=>x.slug)),extra=page.items.filter(x=>x.category===category&&!seen.has(x.slug)&&!!seen.add(x.slug));
      if(page.hasMore&&!extra.length)throw Error('来源重复返回同一页，已停止连续加载；请稍后重试。');
      this.patch({rankings:{...this.state.rankings,[key]:{...page,items:[...old.items,...extra],pending:false,error:''}},items:this.merge(extra)});
    }catch(error){if(generation===this.generation)this.patch({rankings:{...this.state.rankings,[key]:{...old,pending:false,error:message(error)}}});}
  }
  async loadDetail(slug:string,force=false){
    if(this.state.detailPending[slug]||(!force&&this.state.detailLoaded[slug]))return;
    const generation=this.generation;
    this.patch({detailPending:{...this.state.detailPending,[slug]:true},detailErrors:{...this.state.detailErrors,[slug]:''}});
    try{const item=await this.backend.detail(slug,force);if(generation!==this.generation)return;if(item.slug!==slug)throw Error('详情作品不匹配');this.patch({items:{...this.state.items,[slug]:{...this.state.items[slug],...item}},detailLoaded:{...this.state.detailLoaded,[slug]:true}});}
    catch(error){if(generation===this.generation)this.patch({detailErrors:{...this.state.detailErrors,[slug]:message(error)}});}
    finally{if(generation===this.generation)this.patch({detailPending:{...this.state.detailPending,[slug]:false}});}
  }
  async loadRetests(slug:string){
    if(this.state.retestPending[slug])return;
    const generation=this.generation;
    this.patch({retestPending:{...this.state.retestPending,[slug]:true},retestErrors:{...this.state.retestErrors,[slug]:''}});
    try{const data=await this.backend.retests(slug);if(generation===this.generation)this.patch({retests:{...this.state.retests,[slug]:data}});}
    catch(error){if(generation===this.generation)this.patch({retestErrors:{...this.state.retestErrors,[slug]:message(error)}});}
    finally{if(generation===this.generation)this.patch({retestPending:{...this.state.retestPending,[slug]:false}});}
  }
  async loadFavorites(){
    if(this.state.favoritesPending||this.state.favoriteSaving)return;
    this.patch({favoritesPending:true,favoritesError:''});
    try{const favorites=await this.backend.favorites();favorites.items=favorites.items.map(asItem).filter((x):x is GoodcaseItem=>!!x);this.patch({favorites,favoritesLoaded:true,items:this.merge(favorites.items)});}
    catch(error){this.patch({favoritesError:message(error)});}
    finally{this.patch({favoritesPending:false});}
  }
  async favorite(item:GoodcaseItem,saved:boolean):Promise<boolean>{
    if(!this.state.favoritesLoaded||this.state.favoriteSaving||this.state.favoritesPending)return false;
    this.patch({favoriteSaving:true,favoritesError:''});
    try{const favorites=await this.backend.save(item,saved,this.state.favorites.revision);this.patch({favorites});return true;}
    catch(error){this.patch({favoritesError:message(error)});return false;}
    finally{this.patch({favoriteSaving:false});}
  }
}
const stores=new Map<string,GoodcaseStore>();
export function goodcaseStore(root:string){
  let store=stores.get(root);if(!store){store=new GoodcaseStore({collect:collectGoodcase,ranking:fetchRanking,detail:fetchGoodcaseDetail,retests:fetchGoodcaseRetests,favorites:()=>invoke('goodcase_favorites',{root}),save:(item,saved,revision)=>invoke('goodcase_favorite_save',{root,item,saved,revision}),history:()=>invoke('goodcase_snapshot_index',{root}),readSnapshot:id=>invoke('goodcase_snapshot_read',{root,id}),saveSnapshot:snapshot=>invoke('goodcase_snapshot_save',{root,snapshot})});stores.set(root,store);}return store;
}
export function useGoodcase(store:GoodcaseStore){const state=useSyncExternalStore(store.subscribe,store.getSnapshot);useEffect(()=>{store.start();},[store]);return state;}
