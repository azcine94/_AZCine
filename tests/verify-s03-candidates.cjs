// Validate returned READ-ONLY candidate files in a retained harness, without touching production imports.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {validationRun}=require('./support/validation-run.cjs');
const root=path.resolve('.');const input=path.resolve(process.argv[2]||'');
if(!input.startsWith(path.resolve('artifacts/validation')+path.sep))throw Error('Retained candidate run required');
const {out}=validationRun('s03-candidate-checks');
const candidates=['rust-jsonl-1.rs','ts-contract-1.ts','ts-contract-2.ts'];
const hash=()=>Object.fromEntries(candidates.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(input,name))).digest('hex')]));
const report={mode:'isolated pure-module candidate validation; not production or original-reviewer verification',input,before:hash(),commands:[]};
const rust=path.join(out,'rust'),ts=path.join(out,'ts');for(const dir of [rust,path.join(ts,'src'),path.join(ts,'tests')])fs.mkdirSync(dir,{recursive:true});
fs.copyFileSync(path.join(input,candidates[0]),path.join(rust,'lib.rs'));
fs.copyFileSync(path.join(input,candidates[1]),path.join(ts,'src','pi-contract.ts'));
fs.copyFileSync(path.join(input,candidates[2]),path.join(ts,'tests','pi-contract.test.ts'));
fs.writeFileSync(path.join(rust,'Cargo.toml'),'[package]\nname="azcine-pi-jsonl-candidate"\nversion="0.0.0"\nedition="2024"\n[lib]\npath="lib.rs"\n[dependencies]\nserde_json="=1.0.151"\n');
fs.writeFileSync(path.join(ts,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,skipLibCheck:true,allowImportingTsExtensions:true,verbatimModuleSyntax:true,erasableSyntaxOnly:true,noUnusedLocals:true,noUnusedParameters:true,types:['node'],typeRoots:[path.join(root,'app/node_modules/@types')]},include:['src','tests']},null,2));
function command(name,executable,args,options={}){const file=path.join(out,name+'.log'),fd=fs.openSync(file,'wx');const result=spawnSync(executable,args,{cwd:root,stdio:['ignore',fd,fd],timeout:600000,...options});fs.closeSync(fd);report.commands.push({name,executable,args,code:result.status,error:result.error?.message,signal:result.signal,log:file});console.log(name,result.status);if(result.status!==0)process.exitCode=1;}
command('ts-check',process.execPath,[path.join(root,'app/node_modules/typescript/bin/tsc'),'-p',path.join(ts,'tsconfig.json')]);
command('ts-tests',process.execPath,['--experimental-strip-types','--test',path.join(ts,'tests/pi-contract.test.ts')]);
const cargo=path.join(root,'.tooling/cargo/bin/cargo.exe');const env={...process.env,CARGO_HOME:path.join(root,'.tooling/cargo'),RUSTUP_HOME:path.join(root,'.tooling/rustup'),RUSTUP_TOOLCHAIN:'1.99.0-x86_64-pc-windows-msvc',CARGO_TARGET_DIR:path.join(out,'rust-target')};
for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=path.dirname(cargo)+path.delimiter+(process.env.PATH||process.env.Path||'');
command('rust-tests',cargo,['test','--offline','--manifest-path',path.join(rust,'Cargo.toml')],{env});
report.after=hash();report.sourceStable=JSON.stringify(report.before)===JSON.stringify(report.after);if(!report.sourceStable)process.exitCode=1;
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);
