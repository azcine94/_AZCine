//! One-time, read-only-source import of this repository's old task records.
//! The shared database is never attached writable, deleted or downgraded.
use crate::storage::{Store, StorageError};
use crate::task_panel_store::{db_error, invalid};
use crate::task_panel_workspace::{directory, preserve, repository_root};
use rusqlite::{Connection, OptionalExtension, params};
use std::{fs,path::{Path,PathBuf}};

fn table(db:&Connection,name:&str)->Result<bool,StorageError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM legacy.sqlite_schema WHERE type='table' AND name=?)",[name],|r|r.get(0)).map_err(db_error)
}

pub fn import(store:&mut Store,config:&Path)->Result<String,StorageError> {
    if store.task_setting("task-panel:legacy-import")?.is_some() {return Ok(String::new());}
    let locator=config.join("data-root.json");
    if !locator.exists() {return Ok(String::new());}
    let location:serde_json::Value=serde_json::from_slice(&fs::read(locator).map_err(|_|invalid("旧库定位文件不可读，未跳过已有记录。"))?).map_err(|_|invalid("旧库定位文件格式无效，原件保留。"))?;
    let source_root=PathBuf::from(location["root"].as_str().ok_or_else(||invalid("旧库定位缺少目录。"))?);
    if !source_root.is_absolute() {return Err(invalid("旧库定位不是绝对路径。"));}
    let source=source_root.join("db/azcine.sqlite3");
    if !source.exists() {return Ok(String::new());}
    let mut url=url::Url::from_file_path(&source).map_err(|_|invalid("旧库路径无法读取。"))?;
    url.query_pairs_mut().append_pair("mode","ro");
    store.db.execute("ATTACH DATABASE ? AS legacy",[url.as_str()]).map_err(db_error)?;
    let result=(|| {
        let application:i64=store.db.query_row("PRAGMA legacy.application_id",[],|r|r.get(0)).map_err(db_error)?;
        let identity:String=store.db.query_row("SELECT value FROM legacy.app_meta WHERE key='identity'",[],|r|r.get(0)).map_err(db_error)?;
        if application!=0x415A4349 || location["identity"].as_str()!=Some(identity.as_str()){return Err(invalid("原任务库与定位身份不符，未读取其他库的任务。"));}
        import_attached(store,&source_root)
    })();
    let detached=store.db.execute_batch("DETACH DATABASE legacy").map_err(db_error);
    match result {Ok(message)=>{detached?;if store.task_setting("task-panel:legacy-import")?.is_none(){store.save_task_setting("task-panel:legacy-import",&serde_json::json!({"source":source_root,"at":crate::task_panel_store::now(),"matchingRecords":false,"sourcePreserved":true}).to_string())?;}Ok(message)},Err(error)=>{let _=detached;Err(error)}}
}

fn import_attached(store:&mut Store,source_root:&Path)->Result<String,StorageError> {
    if !table(&store.db,"tp_repositories")? {return Ok(String::new());}
    let root=store.task_workspace.as_ref().ok_or_else(||invalid("只允许导入到明确仓库。"))?.clone();
    let old=store.db.prepare("SELECT id,path FROM legacy.tp_repositories").map_err(db_error)?
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    let ids:Vec<_>=old.into_iter().filter(|(_,p)|repository_root(Path::new(p)).ok().as_ref()==Some(&root)).map(|(id,_)|id).collect();
    if ids.is_empty() {return Ok(String::new());}
    let count:i64=store.db.query_row("SELECT count(*) FROM tp_repositories",[],|r|r.get(0)).map_err(db_error)?;
    if count!=0 {return Err(invalid("仓库已有本地任务，同时发现尚未导入的旧记录；未覆盖或混合，请保留两份数据后核对。"));}
    let has_projects=table(&store.db,"tp_projects")?;
    if !has_projects {return Err(invalid("发现早期任务库，需先将原任务库升级至支持项目归属的版本；没有丢弃旧记录。"));}
    let own=store.root.clone();
    let tx=store.db.transaction().map_err(db_error)?;
    tx.execute_batch("CREATE TEMP TABLE migration_repositories(id TEXT PRIMARY KEY);").map_err(db_error)?;
    for id in ids {tx.execute("INSERT INTO migration_repositories VALUES(?)",[id]).map_err(db_error)?;}
    tx.execute_batch("
        CREATE TEMP TABLE migration_projects AS SELECT DISTINCT project_id AS id FROM legacy.tp_project_repositories WHERE repository_id IN migration_repositories;
        CREATE TEMP TABLE migration_tasks AS SELECT t.id FROM legacy.tp_tasks t LEFT JOIN legacy.tp_task_plans p ON p.task_id=t.id WHERE t.repository_id IN migration_repositories OR (t.repository_id IS NULL AND p.project_id IN migration_projects);
        CREATE TEMP TABLE migration_memories AS SELECT m.id FROM legacy.tp_memories m LEFT JOIN legacy.tp_memory_origins o ON o.memory_id=m.id WHERE m.task_id IN migration_tasks OR m.repository_id IN migration_repositories OR (m.task_id IS NULL AND m.repository_id IS NULL AND o.project_id IN migration_projects);
        CREATE TEMP TABLE migration_objects AS SELECT id FROM migration_repositories UNION SELECT id FROM migration_projects UNION SELECT id FROM migration_tasks UNION SELECT id FROM migration_memories UNION SELECT id FROM legacy.tp_bindings WHERE task_id IN migration_tasks UNION SELECT id FROM legacy.tp_executions WHERE task_id IN migration_tasks UNION SELECT id FROM legacy.tp_evidence WHERE task_id IN migration_tasks;
        CREATE TEMP TABLE migration_nodes AS SELECT id FROM legacy.tp_nodes WHERE repository_id IN migration_repositories OR id IN migration_objects;
    ").map_err(db_error)?;
    let cross:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM legacy.tp_relations WHERE active=1 AND ((from_id IN migration_nodes) != (to_id IN migration_nodes)))",[],|r|r.get(0)).map_err(db_error)?;
    if cross {return Err(invalid("旧任务包含跨仓库关联，无法无损拆分到单个 .azcine；已保留原记录，未生成缺少依赖的新看板。"));}
    // Foreign keys may point forward (goal plans, old memory revisions). Check
    // the entire imported subset before commit instead of dropping constraints.
    tx.pragma_update(None,"defer_foreign_keys",true).map_err(db_error)?;
    let selections=[
        ("tp_projects","id IN migration_projects"),
        ("tp_repositories","id IN migration_repositories"),
        ("tp_tasks","id IN migration_tasks"),
        ("tp_nodes","id IN migration_nodes"),
        ("tp_relations","from_id IN migration_nodes AND to_id IN migration_nodes"),
        ("tp_memories","id IN migration_memories"),
        ("tp_bindings","task_id IN migration_tasks"),
        ("tp_snapshots","repository_id IN migration_repositories"),
        ("tp_contexts","task_id IN migration_tasks"),
        ("tp_executions","task_id IN migration_tasks"),
        ("tp_evidence","task_id IN migration_tasks"),
        ("tp_acceptances","task_id IN migration_tasks"),
        ("tp_imports","repository_id IN migration_repositories"),
        ("tp_analysis_versions","import_id IN (SELECT id FROM tp_imports)"),
        ("tp_project_repositories","repository_id IN migration_repositories"),
        ("tp_task_plans","task_id IN migration_tasks"),
        ("tp_memory_origins","memory_id IN migration_memories"),
        ("tp_agent_grants","task_id IN migration_tasks"),
        ("tp_events","object_id IN migration_objects OR object_id IN migration_nodes"),
        ("tp_requests","id IN (SELECT request_id FROM tp_events) OR EXISTS(SELECT 1 FROM json_tree(input) j WHERE j.type='text' AND j.value IN migration_objects) OR EXISTS(SELECT 1 FROM json_tree(result) j WHERE j.type='text' AND j.value IN migration_objects)"),
    ];
    for (name,filter) in selections {tx.execute_batch(&format!("INSERT INTO main.{name} SELECT * FROM legacy.{name} WHERE {filter};")).map_err(db_error)?;}
    tx.execute("UPDATE tp_graph_meta SET revision=(SELECT revision FROM legacy.tp_graph_meta WHERE id=1) WHERE id=1",[]).map_err(db_error)?;
    tx.execute("UPDATE tp_agent_grants SET revoked=1",[]).map_err(db_error)?;
    let files=tx.prepare("SELECT id,path,hash FROM tp_evidence WHERE path<>''").map_err(db_error)?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    let mut missing=Vec::new();
    for (id,path,digest) in files {
        if !crate::task_panel_store::id_ok(&id)||id.contains(':'){return Err(invalid("旧证据编号不能作为本机文件名，未写入。"));}
        let source=Path::new(&path);
        if !source.is_file() {missing.push(id);continue;}
        let bytes=crate::task_panel_paths::protected_absolute(source,64_000_000)?;
        if crate::task_panel_paths::hash(&bytes)!=digest {return Err(invalid("旧交付原件已改变，未将其冒充原验证证据。"));}
        let file=directory(&own,"task-panel/legacy/evidence")?.join(&id);
        preserve(&file,&bytes)?;
        tx.execute("UPDATE tp_evidence SET path=? WHERE id=?",params![file.to_string_lossy(),id]).map_err(db_error)?;
    }
    let imports=tx.prepare("SELECT id FROM tp_imports").map_err(db_error)?.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    for id in imports {
        if !crate::task_panel_store::id_ok(&id) {return Err(invalid("旧分析产物编号无效。"));}
        let destination=directory(&own,&format!("task-panel/imports/{id}"))?;
        for name in ["graph-facts.json","candidate.json","architecture.html"] {
            let file=source_root.join("task-panel/imports").join(&id).join(name);
            if file.is_file() {preserve(&destination.join(name),&crate::task_panel_paths::protected_absolute(&file,32_000_000)?)?;}else{missing.push(format!("{id}/{name}"));}
        }
    }
    let herdr:Option<String>=tx.query_row("SELECT value FROM legacy.app_meta WHERE key='task-panel:herdr'",[],|r|r.get(0)).optional().map_err(db_error)?;
    if let Some(value)=herdr {tx.execute("INSERT INTO app_meta VALUES('task-panel:herdr',?)",[value]).map_err(db_error)?;}
    let receipt=serde_json::json!({"source":source_root,"at":crate::task_panel_store::now(),"missingOriginals":missing,"sourcePreserved":true});
    tx.execute("INSERT INTO app_meta VALUES('task-panel:legacy-import',?)",[receipt.to_string()]).map_err(db_error)?;
    let broken:bool=tx.prepare("PRAGMA foreign_key_check").map_err(db_error)?.exists([]).map_err(db_error)?;
    if broken {return Err(invalid("旧记录存在跨仓库或缺失引用，未提交不完整迁移。"));}
    tx.execute_batch("DROP TABLE migration_nodes; DROP TABLE migration_objects; DROP TABLE migration_memories; DROP TABLE migration_tasks; DROP TABLE migration_projects; DROP TABLE migration_repositories;").map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(if missing.is_empty(){"已将此仓库旧任务及证据复制到 .azcine，原库保留。".into()}else{format!("任务记录已保留到 .azcine；有 {} 项旧原件已缺失，原路径及缺项记录保留，不能视为验证通过。",missing.len())})
}
