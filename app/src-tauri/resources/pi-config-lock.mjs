// App-owned process-outside coordinator. Uses upstream's installed lock library;
// never reads credentials or modifies Pi. Rust retains the transactional writer.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
let releases=[];
const release=()=>{for(const unlock of releases.reverse()){try{unlock();}catch{}}releases=[];};
process.once('exit',release);
process.once('SIGTERM',()=>process.exit(0));
const reply=(request,success)=>process.stdout.write(JSON.stringify({type:'response',id:request.id,command:request.type,success,data:{locked:success}})+'\n');
for await(const line of createInterface({input:process.stdin,terminal:false})){
  let request;
  try{
    request=JSON.parse(line);
    if(request.type!=='acquire'||releases.length)throw Error('invalid');
    const require=createRequire(join(request.package,'package.json'));
    const lockfile=require('proper-lockfile');
    for(const name of ['models.json','auth.json','settings.json']){
      releases.push(lockfile.lockSync(join(request.agent,name),{realpath:false,onCompromised:()=>process.exit(1)}));
    }
    reply(request,true);
  }catch{release();if(request)reply(request,false);}
}
release();
