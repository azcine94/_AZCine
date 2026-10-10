import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import type {Plugin} from 'vite';

// The application startup/build compiles the pinned editor package before Vite
// resolves its generated imports. No local preview server or iframe is used.
export function plainvaEditor():Plugin {return {
  name:'azcine-plainva-editor',
  async configResolved(){
    const script=fileURLToPath(new URL('./bundle.mjs',import.meta.url));
    await promisify(execFile)(process.execPath,[script],{windowsHide:true,maxBuffer:1024*1024});
  },
};}
