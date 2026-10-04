export interface ProviderModel {
  id:string; name:string; contextWindow:number; maxTokens:number; reasoning:boolean; supportsImages:boolean; baseUrl:string; api:string;
}
export interface ProviderView { provider:string; baseUrl:string; api:string; hasCredential:boolean; models:ProviderModel[] }
export interface RemoteModel { id:string; name:string; contextWindow:number|null; maxTokens:number|null; supportsImages:boolean|null }
export interface RemoteModels { models:RemoteModel[]; truncated:boolean }
const invalid=()=>new Error('服务商返回的数据格式不完整，输入保留。');
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string')throw invalid();return v;};
const flag=(v:unknown):boolean=>{if(typeof v!=='boolean')throw invalid();return v;};
const number=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0)throw invalid();return v;};
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw invalid();return v;};
export function parseProviders(value:unknown):ProviderView[]{
  const ids=new Set<string>();
  return list(value).map(item=>{const v=object(item),provider=text(v.provider);if(ids.has(provider))throw invalid();ids.add(provider);
    const models=new Set<string>();
    return {provider,baseUrl:text(v.baseUrl),api:text(v.api),hasCredential:flag(v.hasCredential),models:list(v.models).map(item=>{
      const m=object(item),id=text(m.id);if(models.has(id))throw invalid();models.add(id);
      return {id,name:text(m.name),contextWindow:number(m.contextWindow),maxTokens:number(m.maxTokens),reasoning:flag(m.reasoning),supportsImages:flag(m.supportsImages),baseUrl:text(m.baseUrl),api:text(m.api)};
    })};
  });
}
export function parseRemoteModels(value:unknown):RemoteModels{const v=object(value);return {truncated:flag(v.truncated),models:list(v.models).map(item=>{const m=object(item);return {id:text(m.id),name:text(m.name),contextWindow:m.contextWindow==null?null:number(m.contextWindow),maxTokens:m.maxTokens==null?null:number(m.maxTokens),supportsImages:m.supportsImages==null?null:flag(m.supportsImages)};})};}
