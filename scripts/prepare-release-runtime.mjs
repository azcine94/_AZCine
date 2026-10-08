// Reproduce the pinned Windows runtime on a clean build runner. No user state.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'app/resources/runtime-lock.json'),'utf8'));
const destination=path.join(root,'app/resources/runtime',lock.directory);
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verify(){for(const key of ['node','pi','packageLock'])if(digest(path.join(destination,lock[key]))!==lock.entrySha256[key])throw Error(`Pinned runtime mismatch: ${key}`);}
if(fs.existsSync(destination)){verify();console.log('Pinned Windows runtime already prepared.');process.exit(0);}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Only Windows x64 is supported.');
const stage=fs.mkdtempSync((fs.mkdirSync(path.join(root,'.tooling'),{recursive:true}),path.join(root,'.tooling/release-runtime-')));
async function download(url,file){const response=await fetch(url);if(!response.ok)throw Error(`Download failed: ${response.status} ${url}`);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()),{flag:'wx'});}
const nodeZip=path.join(stage,'node.zip');await download(lock.sources.node,nodeZip);
if(digest(nodeZip)!==lock.sources.nodeArchiveSha256)throw Error('Node archive checksum mismatch.');
fs.mkdirSync(destination,{recursive:true});
const quote=value=>"'"+value.replaceAll("'","''")+"'";
execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(nodeZip)} -DestinationPath ${quote(destination)}`],{windowsHide:true,stdio:'inherit'});
const api=await fetch(`https://api.github.com/repos/earendil-works/pi/releases/tags/v${lock.piVersion}`,{headers:{'User-Agent':'AZCine-runtime-build'}});
if(!api.ok)throw Error('Cannot fetch pinned upstream release.');const release=await api.json();
const pi=path.join(destination,'pi');fs.mkdirSync(pi);
for(const [assetName,output] of [['pi-coding-agent-install-package.json','package.json'],['pi-coding-agent-install-package-lock.json','package-lock.json']]){
 const asset=release.assets.find(item=>item.name===assetName);if(!asset)throw Error('Missing upstream complete install lock');
 await download(asset.browser_download_url,path.join(pi,output));
}
if(digest(path.join(pi,'package-lock.json'))!==lock.entrySha256.packageLock)throw Error('Pi install lock checksum mismatch.');
const nodeDirectory=path.dirname(path.join(destination,lock.node));
for(const dir of ['home','appdata','localappdata','temp','npm-cache','npm-global'])fs.mkdirSync(path.join(stage,dir));
for(const file of ['npm-user.rc','npm-global.rc'])fs.writeFileSync(path.join(stage,file),'');
const system=process.env.SystemRoot;
const env={SystemRoot:system,WINDIR:system,ComSpec:path.join(system,'System32/cmd.exe'),PATH:[nodeDirectory,path.join(system,'System32'),system].join(path.delimiter),HOME:path.join(stage,'home'),USERPROFILE:path.join(stage,'home'),APPDATA:path.join(stage,'appdata'),LOCALAPPDATA:path.join(stage,'localappdata'),TEMP:path.join(stage,'temp'),TMP:path.join(stage,'temp'),NPM_CONFIG_USERCONFIG:path.join(stage,'npm-user.rc'),NPM_CONFIG_GLOBALCONFIG:path.join(stage,'npm-global.rc'),NPM_CONFIG_CACHE:path.join(stage,'npm-cache'),NPM_CONFIG_PREFIX:path.join(stage,'npm-global'),NO_UPDATE_NOTIFIER:'1'};
execFileSync(path.join(destination,lock.node),[path.join(nodeDirectory,'node_modules/npm/bin/npm-cli.js'),'ci','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'],{cwd:pi,env,stdio:'inherit',windowsHide:true});
verify();
fs.writeFileSync(path.join(destination,'runtime-manifest.json'),JSON.stringify({...lock,source:lock.sources},null,2)+'\n',{flag:'wx'});
console.log(`Prepared Node ${lock.nodeVersion} / upstream Pi ${lock.piVersion} for Windows x64.`);
