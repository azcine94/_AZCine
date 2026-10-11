import {noteBodyOf} from './vendor/packages/core/src/frontmatter-block';
// Desktop-local bridge to the pinned upstream algorithms. No remote importer is exposed.
import * as yaml from 'yaml';
import {unzipSync,zipSync} from 'fflate';
import {parseMarkdownAst} from './vendor/packages/core/src/markdown-parser';
import {extractLinksAndTags,extractFrontmatterLinks} from './vendor/packages/core/src/ast-scanner';
import {frontmatterKeys,readFrontmatterPath,setFrontmatterPath,deleteFrontmatterPath} from './vendor/packages/core/src/frontmatter-surgical';
import {scanTasks} from './vendor/packages/core/src/vault/taskScan';
import {setChecklistTaskDone,resolveTaskOrdinal} from './vendor/packages/core/src/vault/taskMutation';
import {renameTagInText,isValidTagName} from './vendor/packages/core/src/vault/renameTag';
import {parseSearchQuery} from './vendor/packages/core/src/vault/ftsQuery';
import {buildFilterNodePredicate,buildPropertyPredicate,parseDatabaseSourceFilter,applySortRules,normalizeSortRules} from './vendor/packages/core/src/vault/databaseQueryHelpers';
import {aggregateRollup,normalizeRollup,wikiLinkTarget} from './vendor/packages/core/src/vault/rollup';
import {buildWikiTargetSet,wikiTargetPath} from './vendor/packages/ui/src/lib/wikiResolver';
import {parseBaseConfig,serializeBaseConfig} from './vendor/packages/ui/src/base/baseFormat';
import {defaultImportRegistry,isSafeArchivePath,isTextPath} from './vendor/packages/core/src/import/index';
import {readTarEntries} from './vendor/packages/core/src/import/tarArchive';
import type {UnpackedFile,ImportOptions,ImportSourceId} from './vendor/packages/core/src/import/ImportTypes';
import {resolveTemplate} from './vendor/packages/ui/src/base/templateEngine';
import {finalizeTemplate,withoutTemplateOnlyKeys} from './vendor/packages/ui/src/base/templateFiles';
import {planLinkUpdates,applyLinkUpdates} from './vendor/packages/ui/src/lib/renameNote';
import {viewPrefill} from './vendor/packages/ui/src/base/newItemPrefill';
import {orderCards,spliceIntoSequence} from './vendor/packages/ui/src/base/pinboardModel';

type Doc={path:string;body:string;version:string;mtime?:number};
function properties(body:string){return Object.fromEntries(frontmatterKeys(body).map(key=>[key,readFrontmatterPath(body,[key])]));}
function analyze(docs:Doc[]){
  const index=buildWikiTargetSet(docs.map(d=>({path:d.path,title:typeof properties(d.body).title==='string'?properties(d.body).title as string:undefined})));
  return docs.filter(d=>/\.(md|markdown)$/i.test(d.path)).map(doc=>{
    const data=extractLinksAndTags(parseMarkdownAst(doc.body,{preserveObsidianSyntax:true})),props=properties(doc.body);
    const links=[...data.links,...extractFrontmatterLinks(props)];
    return {...doc,properties:props,tags:[...new Set(data.tags.map(t=>t.name))],tasks:scanTasks(doc.body),links:links.map(link=>({...link,resolved:wikiTargetPath(link.target,index,doc.path)}))};
  });
}
function search(docs:ReturnType<typeof analyze>,text:string){
  const q=parseSearchQuery(text),excluded=[...text.matchAll(/(?:^|\s)-(?!(?:path|tag):)(?:"([^"]+)"|(\S+))/g)].map(m=>(m[1]||m[2]).toLocaleLowerCase());
  return docs.filter(d=>{const hay=(d.path+'\n'+d.body).toLocaleLowerCase(),path=d.path.toLocaleLowerCase();const tagged=(t:string)=>d.tags.some(x=>x===t||x.startsWith(t+'/'));
    return q.terms.every(t=>hay.includes(t.toLocaleLowerCase()))&&!excluded.some(t=>hay.includes(t))&&q.paths.every(p=>path.includes(p))&&!q.notPaths.some(p=>path.includes(p))&&q.tags.every(tagged)&&!q.notTags.some(tagged);
  }).map(d=>{const text=noteBodyOf(d.body).replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#*`>]+/g,'').replace(/\s+/g,' ').trim();const term=q.terms[0]?.toLocaleLowerCase();const at=term?text.toLocaleLowerCase().indexOf(term):0;return {...d,snippet:text.slice(Math.max(0,at-60),Math.max(0,at-60)+240)};});
}
function baseRows(docs:ReturnType<typeof analyze>,config:any,view:any,definitions:Record<string,string>={}){
  function validate(node:any):void{if(node==null)return;if(typeof node==='string'){if(!parseDatabaseSourceFilter(node)&&!buildPropertyPredicate(node))throw Error('当前上游不支持此筛选表达式：'+node);return;}if(typeof node!=='object'||Array.isArray(node)||Object.keys(node).some(k=>!['and','or','not'].includes(k)))throw Error('无法识别数据库筛选配置，未展示未经筛选的结果。');for(const children of Object.values(node))for(const child of Array.isArray(children)?children:[children])validate(child);}
  validate(config.filters);validate(view?.filters);
  const all=docs.map(d=>({...d.properties,'file.path':d.path,'file.name':d.path.split('/').pop()!.replace(/\.(md|markdown)$/i,''),'file.ext':'md','file.mtime':new Date(d.mtime??0).toISOString(),'file.tags':d.tags.map(t=>'#'+t),'file.tasks':`${d.tasks.filter(t=>t.done).length}/${d.tasks.length}`,_doc:d}));
  const index=buildWikiTargetSet(docs.map(d=>({path:d.path,title:typeof properties(d.body).title==='string'?properties(d.body).title as string:undefined})));
  for(const row of all)for(const [key,column] of Object.entries<any>(config.columns??{}))if(column.reverseOf){const raw=definitions[column.reverseOf.base];if(!raw)throw Error('反向关系引用的数据库不可用：'+column.reverseOf.base);const source=parseBaseConfig(raw),predicate=buildFilterNodePredicate(source.filters,{hasTag:(r:any,t:string)=>r._doc.tags.includes(t)});(row as any)[key]=all.filter(r=>(!predicate||predicate(r))&&[r[column.reverseOf.property as keyof typeof r]].flat().some(value=>{const link=wikiLinkTarget(value);return link&&wikiTargetPath(link,index,r['file.path'])===row['file.path'];})).map(r=>`[[${r['file.path'].replace(/\.md$/i,'')}]]`);}
  const rows=all.map(row=>{
    for(const [key,column] of Object.entries<any>(config.columns??{})){
      const spec=normalizeRollup(column.rollup);if(!spec)continue;
      const value=(row as any)[spec.through.replace(/^note\./,'')];const links=(Array.isArray(value)?value:[value]).map(wikiLinkTarget).filter(Boolean).map(t=>wikiTargetPath(t!,index,row['file.path']));
      const targets=all.filter(r=>links.includes(r['file.path']));(row as any)[key]=aggregateRollup(spec,targets.map(r=>spec.of?(r as any)[spec.of.replace(/^note\./,'')]:1));
    }return row;
  });
  const ctx={hasTag:(row:any,tag:string)=>row._doc.tags.some((t:string)=>t===tag||t.startsWith(tag+'/'))};
  const a=buildFilterNodePredicate(config.filters,ctx),b=buildFilterNodePredicate(view?.filters,ctx);
  return applySortRules(rows.filter(r=>(!a||a(r))&&(!b||b(r))),normalizeSortRules(view?.sort));
}
const sources=defaultImportRegistry.list().filter(s=>s.inputKind!=='api');
export const localTools={
  viewPrefill,orderCards,spliceIntoSequence,
  resolvePath:(paths:string[],target:string,from:string)=>wikiTargetPath(target,buildWikiTargetSet(paths.map(path=>({path}))),from),
  renamePlan:async(docs:ReturnType<typeof analyze>,oldPath:string,newPath:string,paths=docs.map(d=>d.path))=>planLinkUpdates({db:{query:async()=>paths.map(path=>({path}))} as any,getBacklinks:async()=>docs.flatMap(d=>d.links.filter(l=>l.resolved===oldPath).map(l=>({source_path:d.path,target_path:l.rawTarget??l.target,property_key:'propertyKey' in l?l.propertyKey:null}))) as any},oldPath,newPath),
  renameApply:applyLinkUpdates,
  template:(text:string,title:string,folder:string,vaultName:string)=>resolveTemplate(text,{title,folder,vaultName,now:new Date()},'interactive'),
  finishTemplate:(text:string,answers:Record<string,string>)=>withoutTemplateOnlyKeys(finalizeTemplate(text,answers).text),
  analyze,search,properties,parseBase:parseBaseConfig,serializeBase:serializeBaseConfig,baseRows,
  value:(text:string)=>yaml.parse(text),stringify:(value:unknown)=>yaml.stringify(value),
  property:(body:string,key:string,value:unknown,remove=false)=>remove?deleteFrontmatterPath(body,[key]):setFrontmatterPath(body,[key],value),
  task:(body:string,reference:any,done:boolean)=>setChecklistTaskDone(body,resolveTaskOrdinal(body,reference),done).content,
  renameTag:(body:string,oldTag:string,newTag:string)=>{if(!isValidTagName(newTag))throw Error('标签不能为空或含空格');return renameTagInText(body,oldTag,newTag).content;},
  importSources:()=>sources.map(s=>({id:s.id,name:s.name,description:s.description,options:s.options??[]})),
  unpack:async(files:File[])=>{
    const entries:UnpackedFile[]=[],bytes=new Map<string,Uint8Array>(),warnings:string[]=[];let total=0;
    function add(path:string,data:Uint8Array,mtimeMs?:number){
      path=path.replace(/\\/g,'/');if(path.endsWith('/'))return;
      if(!isSafeArchivePath(path))throw Error('导入包含不可用路径：'+path);if(path.split('/').some(p=>p.startsWith('.'))){warnings.push('跳过隐藏文件：'+path);return;}
      total+=data.length;if(data.length>64*1024*1024||total>256*1024*1024||entries.length>=20000)throw Error('本次导入超出限制（单文件64MB、合计256MB、20000个文件），请拆分导入。');
      if(bytes.has(path))throw Error('导入中有重复路径：'+path);bytes.set(path,data);
      const isText=isTextPath(path);entries.push({relativePath:path,content:isText?new TextDecoder('utf-8',{fatal:true}).decode(data):'',isText,sourcePath:path,byteSize:data.length,mtimeMs});
    }
    for(const file of files){if(file.size>256*1024*1024)throw Error('导入文件超过256MB。');const data=new Uint8Array(await file.arrayBuffer());
      if(/\.zip$/i.test(file.name)){let budget=0;const unpacked=unzipSync(data,{filter:e=>{budget+=e.originalSize;if(e.originalSize>64*1024*1024||budget+total>256*1024*1024)throw Error('压缩包解压后过大，请拆分导入。');return true;}});for(const [path,body]of Object.entries(unpacked))add(path,body);}
      else if(/\.(jex|tar)$/i.test(file.name)){const tar=await readTarEntries({size:data.length,read:async(offset,length)=>data.slice(offset,offset+length)});for(const entry of tar){const before=entries.length;add(entry.relativePath,data.slice(entry.offset,entry.offset+entry.size),entry.mtimeMs);if(entries.length>before)entries[entries.length-1].sourceFormat='jex';}}
      else add(file.webkitRelativePath||file.name,data,file.lastModified);
    }return {entries,bytes,warnings};
  },
  importAnalyze:(id:string,entries:UnpackedFile[],options:ImportOptions)=>{const source=sources.find(s=>s.id===id as ImportSourceId);if(!source)throw Error('不支持的本地导入来源');return source.analyze(entries,options);},
  importRun:(id:string,entries:UnpackedFile[],options:ImportOptions,progress:(percent:number,text:string)=>void)=>{const source=sources.find(s=>s.id===id);if(!source)throw Error('不支持的本地导入来源');return source.run(entries,{...options,serializeBase:serializeBaseConfig},progress);},
  zip:(files:Record<string,Uint8Array>)=>zipSync(files,{level:0}),
};
