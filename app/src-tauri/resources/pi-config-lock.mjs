// App-owned process-outside coordinator. Uses upstream's installed lock library;
// never reads credentials or modifies Pi. Rust retains the transactional writer.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
const owned = new Map();
let protectedDirectories = false, compromised;
let releases = [];
const lost = () => Object.assign(new Error('lock ownership lost'), { code: 'ECOMPROMISED' });
function identity(path) {
  const value = fs.lstatSync(path, { bigint: true });
  if (!value.isDirectory() || value.isSymbolicLink() || value.ino === 0n) throw lost();
  return `${value.dev}:${value.ino}`;
}
function verify(path) {
  const entry = owned.get(path);
  if (!entry || identity(path) !== entry.identity) throw lost();
  return entry;
}
// proper-lockfile's public fs adapter retains its mkdir/heartbeat/stale protocol.
// Rust pins these exact Windows directories against deletion BEFORE protect.
// Only then can mtime changes from a sync client be ignored: ownership is checked
// by file identity, and even a stale native contender cannot remove a pinned dir.
const lockingFs = {
  ...fs,
  mkdirSync(path) {
    fs.mkdirSync(path);
    owned.set(path, { identity: identity(path), mtime: fs.statSync(path).mtime });
  },
  statSync(path) {
    const stat = fs.statSync(path);
    if (!stat.isDirectory()) throw Object.assign(new Error('invalid lock directory'), { code: 'ENOTDIR' });
    if (owned.has(path)) {
      const entry = verify(path);
      if (protectedDirectories) stat.mtime = entry.mtime;
      else entry.mtime = stat.mtime;
    }
    return stat;
  },
  utimesSync(path, atime, mtime) {
    const entry = verify(path);
    fs.utimesSync(path, atime, mtime);
    verify(path);
    entry.mtime = mtime;
  },
  rmdirSync(path) {
    // Also used by the upstream exit handler. Never delete a replacement lock.
    if (owned.has(path)) verify(path);
    fs.rmdirSync(path);
    owned.delete(path);
  },
};
function release() {
  let failure;
  for (const unlock of releases.reverse()) { try { unlock(); } catch (error) { failure ??= error; } }
  releases = [];
  return failure;
}
process.once('exit',release);
process.once('SIGTERM',()=>process.exit(0));
const errorCode = error => ['ELOCKED', 'EBUSY'].includes(error?.code) ? 'busy'
  : error?.code === 'ECOMPROMISED' || error?.code === 'ERELEASED' ? 'lost'
  : ['EACCES', 'EPERM'].includes(error?.code) ? 'permission' : 'io';
const reply=(request,error)=>process.stdout.write(JSON.stringify({type:'response',id:request.id,command:request.type,success:!error,data:{locked:!error},...(error?{errorCode:errorCode(error)}:{})})+'\n');
for await(const line of createInterface({input:process.stdin,terminal:false})){
  let request;
  try{
    request=JSON.parse(line);
    if (request.type === 'release') { const error = release(); reply(request, error); continue; }
    if (request.type === 'protect' || request.type === 'check') {
      if (compromised) throw compromised;
      if (!releases.length) throw lost();
      for (const path of owned.keys()) verify(path);
      if (request.type === 'protect') {
        if (process.platform !== 'win32') throw lost();
        protectedDirectories = true;
      }
      reply(request); continue;
    }
    if(request.type!=='acquire'||releases.length)throw Error('invalid');
    const require=createRequire(join(request.package,'package.json'));
    const lockfile=require('proper-lockfile');
    const names=['models.json','auth.json','settings.json'];
    if(request.catalog===true)names.push('models-store.json');
    for(const name of names){
      // Native async auth/cache transactions use a 30s stale threshold (sync
      // uses 10s). Never reclaim their still-active 15s heartbeat as stale.
      releases.push(lockfile.lockSync(join(request.agent,name),{realpath:false,fs:lockingFs,
        stale: ['auth.json','models-store.json'].includes(name) ? 30000 : 10000,
        update:5000,onCompromised:error=>{compromised=error;}}));
    }
    reply(request);
  }catch(error){if(request?.type==='acquire')release();if(request)reply(request,error);}
}
release();
