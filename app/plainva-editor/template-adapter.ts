// Templates are read from the selected vault, never seeded with demo content.
export let templates:{path:string;title:string;body:string}[]=[];
let provider:()=>Promise<typeof templates>=async()=>[];
export function setTemplateProvider(next:typeof provider){provider=next;templates=[];}
export async function getTemplateFolder(){return 'Templates';}
export async function listTemplates(){templates=await provider();return templates.map(({path,title})=>({path,title}));}
const unsupported=()=>{throw new Error('TemplatePicker requires the host onPick callback');};
export const activeDocument={get:unsupported};
export const applyTemplateInteractive=unsupported,withShellContext=unsupported,makeDailyPathProvider=unsupported;
