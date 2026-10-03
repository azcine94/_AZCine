// Isolated native configuration candidate checks. All private fixtures remain in the run.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {validationRun}=require('./support/validation-run.cjs');
const root=path.resolve('.'); const source=path.resolve(process.argv[2]||'');
const merge=path.resolve('artifacts/validation/s03-protocol-candidates-2026-10-02T22-55-48-629104Z/pi-model-config.rs');
if(!source.startsWith(path.resolve('artifacts/validation')+path.sep))throw Error('Retained candidate required');
const {out}=validationRun('s03-config-store-checks');const crate=path.join(out,'harness');fs.mkdirSync(crate);
const files=[merge,path.join(source,'pi-config-store.rs'),path.join(source,'pi-launch-plan.rs'),path.join(source,'pi-projection.rs')];const hash=()=>Object.fromEntries(files.map(p=>[path.relative(root,p),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const report={mode:'isolated candidate filesystem tests, no production IPC/model call; credentials are explicit fixtures',before:hash()};
for(const p of files)fs.copyFileSync(p,path.join(crate,path.basename(p)));
fs.writeFileSync(path.join(crate,'lib.rs'),'#[path="pi-model-config.rs"] pub mod pi_model_config;\n#[path="pi-config-store.rs"] pub mod pi_config_store;\n#[path="pi-launch-plan.rs"] pub mod pi_launch_plan;\n#[path="pi-projection.rs"] pub mod pi_projection;\n');
fs.writeFileSync(path.join(crate,'Cargo.toml'),'[package]\nname="azcine-pi-config-candidate"\nversion="0.0.0"\nedition="2024"\n[lib]\npath="lib.rs"\n[dependencies]\nserde={version="=1.0.229",features=["derive"]}\nserde_json="=1.0.151"\nurl="=2.5.8"\ntempfile="=3.27.0"\n');
const cargo=path.join(root,'.tooling/cargo/bin/cargo.exe');const env={...process.env,CARGO_HOME:path.join(root,'.tooling/cargo'),RUSTUP_HOME:path.join(root,'.tooling/rustup'),RUSTUP_TOOLCHAIN:'1.99.0-x86_64-pc-windows-msvc',CARGO_TARGET_DIR:path.join(out,'target'),AZCINE_PI_CONFIG_TEST_ROOT:path.join(out,'retained-test-data')};
for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=path.dirname(cargo)+path.delimiter+(process.env.PATH||process.env.Path||'');
const log=path.join(out,'cargo-test.log'),fd=fs.openSync(log,'wx');const args=['test','--offline','--manifest-path',path.join(crate,'Cargo.toml')];
const result=spawnSync(cargo,args,{cwd:root,env,stdio:['ignore',fd,fd],timeout:600000});fs.closeSync(fd);
report.command={executable:cargo,args,exitCode:result.status,error:result.error?.message,log};report.after=hash();report.sourceStable=JSON.stringify(report.before)===JSON.stringify(report.after);report.passed=result.status===0&&report.sourceStable;
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,exitCode:result.status}));if(!report.passed)process.exitCode=1;
