use crate::storage::{StorageError,Store};
use crate::task_panel_store::{bump_graph,db_error,encode,event,expected,invalid,new_id,now,receipt,repository,request};
use crate::task_panel_paths::{hash,read_limited,scoped_file};
use crate::task_panel_snapshots::sample;
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashMap,path::{Component,Path}};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct IndexInput {pub request_id:String,pub repository_id:String,pub expected_graph_revision:i64,pub approved:bool}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct IndexReport {pub id:String,pub repository_id:String,pub graph_revision:i64,pub fingerprint:String,pub scanned_files:usize,pub added_relations:usize,pub unknowns:Vec<String>,pub coverage:Vec<String>,pub exclusions:Vec<String>,pub created_at:String}
#[derive(Debug,Clone)]
struct Token {text:String,line:usize,string:bool}
// A bounded lexer for explicit declaration syntax. It skips comments and treats
// templates/regex/dynamic arguments as unknown; it does not claim whole-program calls.
fn tokens(text:&str,is_typescript:bool)->Vec<Token>{
    let c:Vec<char>=text.chars().collect();let mut out=Vec::new();let(mut i,mut line)=(0,1);
    while i<c.len()&&out.len()<200_000 {
        if c[i].is_whitespace(){if c[i]=='\n'{line+=1;}i+=1;continue;}
        if c[i]=='/'&&c.get(i+1)==Some(&'/'){while i<c.len()&&c[i]!='\n'{i+=1;}continue;}
        if c[i]=='/'&&c.get(i+1)==Some(&'*'){i+=2;let mut depth=1;while i+1<c.len()&&depth>0{if c[i]=='\n'{line+=1;}if c[i]=='/'&&c[i+1]=='*'{depth+=1;i+=2;}else if c[i]=='*'&&c[i+1]=='/'{depth-=1;i+=2;}else{i+=1;}}continue;}
        // Slash expressions can be regex literals or division. Conservatively skip
        // the rest of that line instead of extracting apparent imports from regex.
        if is_typescript&&c[i]=='/'{while i<c.len()&&c[i]!='\n'{i+=1;}out.push(Token{text:"<slash-expression>".into(),line,string:false});continue;}
        let start=line;
        if ['\'', '"','`'].contains(&c[i]) {
            let q=c[i];i+=1;let mut value=String::new();let mut literal=q!='`';let mut closed=false;
            while i<c.len(){if c[i]==q{i+=1;closed=true;break;}if c[i]=='\\'{literal=false;i+=1;if i<c.len(){value.push(c[i]);i+=1;}continue;}if c[i]=='\n'{line+=1;literal=false;}value.push(c[i]);i+=1;}
            out.push(Token{text:if closed&&literal{value}else{String::new()},line:start,string:literal&&closed});continue;
        }
        if c[i].is_alphanumeric()||c[i]=='_'||c[i]=='$'{let mut value=String::new();while i<c.len()&&(c[i].is_alphanumeric()||c[i]=='_'||c[i]=='$'){value.push(c[i]);i+=1;}out.push(Token{text:value,line:start,string:false});}
        else if c[i]==':'&&c.get(i+1)==Some(&':'){out.push(Token{text:"::".into(),line:start,string:false});i+=2;}
        else{out.push(Token{text:c[i].to_string(),line:start,string:false});i+=1;}
    }out
}
fn normalize(base:&str,relative:&str)->Option<String>{
    let path=Path::new(base).parent().unwrap_or_else(||Path::new("")).join(relative);let mut parts=Vec::new();
    for c in path.components(){match c{Component::Normal(s)=>parts.push(s.to_string_lossy().to_string()),Component::ParentDir=>{parts.pop()?;},Component::CurDir=>{},_=>return None}}
    Some(parts.join("/"))
}
pub(crate) fn stable(repo:&str,kind:&str,path:&str,symbol:&str)->Result<String,StorageError>{Ok(format!("node-{}",hash(encode(&(repo,kind,path.replace('\\',"/"),symbol))?.as_bytes())))}
impl Store {
    pub fn task_panel_index(&mut self,input:IndexInput)->Result<IndexReport,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        if !input.approved{return Err(invalid("只读索引需确认仓库与读取范围。"));}
        let repo=repository(&self.db,&input.repository_id)?;let snap=sample(&repo,&repo.scope)?;
        let mut node_rows:Vec<(String,String,String,String,Value)>=Vec::new();let mut edges:Vec<(String,String,String,String,Value)>=Vec::new();let mut command_nodes=HashMap::new();let mut parsed=Vec::new();let mut unknowns=Vec::new();
        let paths:Vec<_>=snap.files.iter().map(|f|f.path.clone()).collect();
        for f in &snap.files {
            let ext=Path::new(&f.path).extension().and_then(|e|e.to_str()).unwrap_or("");
            if !["ts","tsx","rs","json"].contains(&ext){continue;}
            if parsed.len()>=1500{return Err(invalid("显式索引上限为 1500 个源码文件，请缩小仓库读取范围。"));}
            let bytes=read_limited(&scoped_file(Path::new(&repo.path),&f.path,&repo.scope)?,2_000_000)?;
            let Ok(text)=String::from_utf8(bytes) else{unknowns.push(format!("非 UTF-8 文件未解析：{}",f.path));continue;};
            let id=stable(&repo.id,"file",&f.path,"")?;
            node_rows.push((id.clone(),"file".into(),f.path.clone(),String::new(),json!([{"path":f.path,"sha256":f.hash,"parser":"explicit-syntax-v1"}])));
            let toks=tokens(&text,ext=="ts"||ext=="tsx");
            if ["ts","tsx","rs"].contains(&ext) {for (i,token) in toks.iter().enumerate(){
                let declaration=if ext=="rs"{["fn","struct","enum","trait","type"].contains(&token.text.as_str())}else{["function","class","interface","type","enum"].contains(&token.text.as_str())};
                if token.string||!declaration||i>0&&toks[i-1].text=="."{continue;}
                let Some(name)=toks.get(i+1).filter(|n|!n.string&&n.text.chars().next().is_some_and(|c|c.is_alphabetic()||c=='_')) else{continue;};
                let symbol_id=stable(&repo.id,"symbol",&f.path,&name.text)?;
                let source=json!({"path":f.path,"lineStart":token.line,"sha256":f.hash,"parser":"explicit-declaration-v2","declaration":token.text,"scopeResolution":"not_performed"});
                if let Some(row)=node_rows.iter_mut().find(|row|row.0==symbol_id){if let Some(sources)=row.4.as_array_mut(){sources.push(source);}}
                else{node_rows.push((symbol_id.clone(),"symbol".into(),f.path.clone(),name.text.clone(),json!([source])));}
                edges.push((id.clone(),symbol_id,"contains".into(),"observed".into(),json!({"path":f.path,"lineStart":token.line,"sha256":f.hash,"meaning":"源码中的显式声明位置；未解析作用域与类型"})));
            }}
            if (ext=="ts"||ext=="tsx")&&toks.iter().any(|t|t.text=="<slash-expression>") {unknowns.push(format!("词法索引不解析斜杠表达式（正则或除法），其同行剩余内容未覆盖：{}",f.path));}
            if ext=="rs" {for (i,t) in toks.iter().enumerate(){if t.text=="fn" {if let Some(name)=toks.get(i+1){let before=&toks[i.saturating_sub(15)..i];if before.windows(3).any(|w|w[0].text=="tauri"&&w[1].text=="::"&&w[2].text=="command") {
                let nid=stable(&repo.id,"command",&f.path,&name.text)?;command_nodes.insert(name.text.clone(),nid.clone());node_rows.push((nid,"command".into(),f.path.clone(),name.text.clone(),json!([{"path":f.path,"lineStart":t.line,"sha256":f.hash,"parser":"rust-command-declaration"}])));
            }}}}}
            parsed.push((f.clone(),id,text,toks));
        }
        for (f,id,text,toks) in &parsed {
            for (i,token) in toks.iter().enumerate() {
                if token.string||toks.get(i+1).is_none_or(|next|next.text!="(")||i>0&&["function","fn",".","::","new"].contains(&toks[i-1].text.as_str()){continue;}
                if let Some(symbol)=node_rows.iter().find(|row|row.1=="symbol"&&row.2==f.path&&row.3==token.text&&row.4.as_array().is_some_and(|sources|sources.len()==1)) {
                    edges.push((id.clone(),symbol.0.clone(),"calls".into(),"claim".into(),json!({"path":f.path,"lineStart":token.line,"sha256":f.hash,"parser":"same-file-call-candidate-v2","meaning":"同文件裸标识符调用候选；未排除遮蔽或类型差异"})));
                }
            }
            if f.path.ends_with(".rs") {for (i,token) in toks.iter().enumerate(){
                if token.string||token.text!="mod"||toks.get(i+2).is_none_or(|s|s.text!=";"){continue;}
                let Some(name)=toks.get(i+1) else{continue;};
                let explicit=toks[i.saturating_sub(8)..i].windows(3).find_map(|w|(w[0].text=="path"&&w[1].text=="="&&w[2].string).then(||w[2].text.clone()));
                let base=explicit.unwrap_or_else(||format!("{}.rs",name.text));
                let target=normalize(&f.path,&base).filter(|p|paths.contains(p)).or_else(||normalize(&f.path,&format!("{}/mod.rs",name.text)).filter(|p|paths.contains(p)));
                if let Some(target)=target {let target_id=stable(&repo.id,"file",&target,"")?;if node_rows.iter().any(|n|n.0==target_id){edges.push((id.clone(),target_id,"imports".into(),"claim".into(),json!({"path":f.path,"lineStart":token.line,"sha256":f.hash,"parser":"rust-module-candidate-v2","meaning":"显式模块文件候选；条件编译与宏未展开"})));}}
            }}
            let is_ts=f.path.ends_with(".ts")||f.path.ends_with(".tsx");
            if is_ts {for (i,t) in toks.iter().enumerate(){
                if ["import","export"].contains(&t.text.as_str())&&!t.string {
                    if toks.get(i+1).is_some_and(|s|s.text=="("||s.text=="."){unknowns.push(format!("动态导入未覆盖：{}:{}",f.path,t.line));continue;}
                    let reference=if toks.get(i+1).is_some_and(|s|s.string){toks.get(i+1)}else{toks.iter().skip(i+1).take_while(|s|s.text!=";"&&s.line<t.line+12).collect::<Vec<_>>().windows(2).find_map(|w|if w[0].text=="from"&&w[1].string{Some(w[1])}else{None})};
                    if let Some(reference)=reference {if reference.text.starts_with('.'){
                        if let Some(base)=normalize(&f.path,&reference.text){let target=[base.clone(),format!("{base}.ts"),format!("{base}.tsx"),format!("{base}/index.ts"),format!("{base}/index.tsx")].into_iter().find(|p|paths.contains(p));
                            if let Some(target)=target {let target_id=stable(&repo.id,"file",&target,"")?;if !node_rows.iter().any(|n|n.0==target_id){if let Some(target_file)=snap.files.iter().find(|n|n.path==target){node_rows.push((target_id.clone(),"file".into(),target.clone(),String::new(),json!([{"path":target,"sha256":target_file.hash}])));}}
                                edges.push((id.clone(),target_id.clone(),"imports".into(),"observed".into(),json!({"path":f.path,"lineStart":reference.line,"sha256":f.hash,"moduleSpecifier":reference.text,"parser":"typescript-explicit-import","fingerprint":snap.fingerprint})));
                                edges.push((target_id,id.clone(),"may_affect".into(),"claim".into(),json!({"inference":"显式引用形成的静态影响候选；不代表实际执行调用","path":f.path,"sha256":f.hash,"lineStart":reference.line,"fingerprint":snap.fingerprint})));
                            }else{unknowns.push(format!("引用未在读取范围内解析：{} → {}",f.path,reference.text));}
                        }
                    }else{unknowns.push(format!("包或别名引用未解析：{} → {}",f.path,reference.text));}}
                }
                if t.text=="invoke"&&!t.string&&toks.get(i+1).is_some_and(|s|s.text=="("||s.text=="<") {
                    let args:Vec<_>=toks.iter().skip(i+1).take(18).collect();let name=args.windows(2).find_map(|w|if w[0].text=="("&&w[1].string{Some(w[1])}else{None});
                    if let Some(name)=name {if let Some(target)=command_nodes.get(&name.text){edges.push((id.clone(),target.clone(),"may_affect".into(),"claim".into(),json!({"path":f.path,"lineStart":name.line,"command":name.text,"sha256":f.hash,"inference":"invoke 字面量候选；未证明局部标识符绑定或运行时调用","fingerprint":snap.fingerprint})));}else{unknowns.push(format!("前端命令未在允许源码中定位：{}:{} {}",f.path,name.line,name.text));}}
                    else{unknowns.push(format!("动态 invoke 未解析：{}:{}",f.path,t.line));}
                }
            }}
            if f.path.ends_with(".rs") {for (i,t) in toks.iter().enumerate(){
                if t.text=="generate_handler"&&!t.string&&toks.get(i+1).is_some_and(|s|s.text=="!")&&toks.get(i+2).is_some_and(|s|s.text=="[") {
                    for name in toks.iter().skip(i+3).take_while(|s|s.text!="]"){if let Some(target)=command_nodes.get(&name.text){edges.push((id.clone(),target.clone(),"registers".into(),"observed".into(),json!({"path":f.path,"lineStart":name.line,"sha256":f.hash,"parser":"tauri-handler-list","fingerprint":snap.fingerprint})));}}
                }
                if t.text=="commands"&&!t.string&&toks.get(i+1).is_some_and(|s|s.text=="(")&&toks.get(i+2).is_some_and(|s|s.text=="&")&&toks.get(i+3).is_some_and(|s|s.text=="[") {
                    for name in toks.iter().skip(i+4).take_while(|s|s.text!="]").filter(|s|s.string){if let Some(target)=command_nodes.get(&name.text){edges.push((id.clone(),target.clone(),"registers".into(),"observed".into(),json!({"path":f.path,"lineStart":name.line,"sha256":f.hash,"parser":"tauri-manifest-command-list","fingerprint":snap.fingerprint})));}}
                }
            }}
            if f.path.ends_with(".json")&&f.path.contains("capabilities/"){
                if let Ok(value)=serde_json::from_str::<Value>(text){if let Some(permissions)=value["permissions"].as_array(){for p in permissions {let permission=p.as_str().or_else(||p["identifier"].as_str()).unwrap_or("");if let Some(command)=permission.strip_prefix("allow-"){let command=command.replace('-',"_");if let Some(target)=command_nodes.get(&command){edges.push((id.clone(),target.clone(),"supported_by".into(),"observed".into(),json!({"path":f.path,"sha256":f.hash,"permission":permission,"parser":"tauri-capability-json","fingerprint":snap.fingerprint})));}}}}}
                else{unknowns.push(format!("capability JSON 无法解析：{}",f.path));}
            }
        }
        if sample(&repo,&repo.scope)?.fingerprint!=snap.fingerprint{return Err(invalid("索引期间源码改变，未应用混合版本关系。"));}
        unknowns.push("范围限显式 import/export、Tauri 命令声明/登记/权限；宏展开、动态调用、别名、运行时语义及其他语言未覆盖。".into());unknowns.sort();unknowns.dedup();
        let tx=self.db.transaction().map_err(db_error)?;expected(crate::task_panel_store::graph_revision(&tx)?,Some(input.expected_graph_revision))?;
        let mut combined:Vec<(String,String,String,String,Value)>=Vec::new();
        for (from,to,kind,level,source) in edges {if let Some(old)=combined.iter_mut().find(|r|r.0==from&&r.1==to&&r.2==kind){if let Some(refs)=old.4.as_array_mut(){if !refs.contains(&source){refs.push(source);}}}else{combined.push((from,to,kind,level,json!([source])));}}
        let edges=combined;
        let mut count=0;
        let known_relations=crate::task_panel_store::relations(&tx)?;
        for (id,kind,path,symbol,sources) in &node_rows{
            let previous:Option<String>=tx.query_row("SELECT sources FROM tp_nodes WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
            if previous.as_ref().is_some_and(|old|old!=&encode(sources).unwrap_or_default()){event(&tx,&input.request_id,id,"node_index_replaced","observed",&encode(&json!({"previousSources":previous,"fingerprint":snap.fingerprint}))?)?;}
            tx.execute("INSERT INTO tp_nodes VALUES(?1,?2,?3,?4,?5,?6,'observed',?7,0) ON CONFLICT(id) DO UPDATE SET sources=excluded.sources,evidence_level='observed',stale=0",params![id,repo.id,kind,if symbol.is_empty(){path}else{symbol},path,symbol,encode(sources)?]).map_err(db_error)?;
        }
        for (from,to,kind,level,source) in &edges {
            let prior=known_relations.iter().find(|r|r.active&&r.from_id==*from&&r.to_id==*to&&r.kind==*kind);
            let encoded_source=encode(source)?;
            if let Some(old)=prior{if old.source!=encoded_source{
                event(&tx,&input.request_id,&old.id,"relation_index_replaced","observed",&encode(&json!({"previous":old,"fingerprint":snap.fingerprint}))?)?;
                tx.execute("UPDATE tp_relations SET source=?1,evidence_level=?2,revision=revision+1 WHERE id=?3",params![encoded_source,level,old.id]).map_err(db_error)?;
            }}else {tx.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,'none',?5,?6,1,1)",params![new_id(&tx,"rel")?,from,to,kind,encoded_source,level]).map_err(db_error)?;count+=1;}
        }
        unknowns.push("符号仅覆盖显式声明；调用仅为同文件裸标识符候选，未解析作用域遮蔽、跨语言、宏、类型或动态调用。源码索引不能证明任务完成。".into());
        unknowns.extend(snap.unknowns);
        let result=IndexReport{id:new_id(&tx,"index")?,repository_id:repo.id,graph_revision:bump_graph(&tx)?,fingerprint:snap.fingerprint,scanned_files:parsed.len(),added_relations:count,unknowns,coverage:repo.scope,exclusions:vec!["credentials / tool caches / Git metadata / ignored files".into()],created_at:now()};
        event(&tx,&input.request_id,&result.repository_id,"static_index","observed",&encode(&result)?)?;receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
}
