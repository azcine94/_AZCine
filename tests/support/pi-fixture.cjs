// Explicit browser-only fixture. Never imported by application startup or Rust.
function installPiFixture(){
  window.isTauri=true;const callbacks=new Map(),listeners=new Map();let callbackId=0,eventId=0;
  const projection=()=>({messages:[],partial:null,tools:[],steering:[],followUp:[],activity:'idle',outcome:'none',notice:null});
  const nativeModel={id:'fixture-model',name:'明确回放模型',provider:'fixture-service',api:'openai-responses',input:['text','image'],reasoning:false,contextWindow:128000,maxTokens:8192};
  const state=id=>({sessionId:id,sessionFile:`X:/ExplicitReplay/pi/sessions/${id}.jsonl`,sessionName:null,model:null,thinkingLevel:'off',isStreaming:false,isCompacting:false,pendingMessageCount:0,messageCount:0});
  const fresh=()=>({generation:0,seq:0,connection:'disconnected',busy:false,stopping:false,sending:false,state:null,models:[],projection:projection(),recoveredQueue:[],error:null,notice:null,cwd:null,runtime:null,paths:null});
  window.piFixture={snapshot:fresh(),calls:[],mode:'success',sendPending:null,saved:false,model:nativeModel,sessions:[],event(){this.snapshot.seq++;for(const [id,l]of listeners)if(l.event==='azcine-pi-changed')callbacks.get(l.handler)?.({id,event:l.event,payload:null});},ready(id='fixture-session'){this.snapshot={...this.snapshot,generation:this.snapshot.generation+1,connection:'ready',busy:false,state:state(id),projection:projection(),cwd:'X:/ExplicitReplay/pi/workspaces/default',runtime:{piVersion:'0.99.1',nodeVersion:'24.21.0',root:'X:/ExplicitRuntime'},paths:{agent:'X:/ExplicitReplay/pi/agent',sessions:'X:/ExplicitReplay/pi/sessions',defaultCwd:'X:/ExplicitReplay/pi/workspaces/default'}};this.event();},enableModel(){this.snapshot.models=[structuredClone(nativeModel)];this.snapshot.state.model=structuredClone(nativeModel);this.event();},resolveSend(disposition='started'){const p=this.sendPending;this.sendPending=null;p.resolve({generation:p.args.input.generation,sessionId:p.args.input.sessionId,disposition});},rejectSend(){const p=this.sendPending;this.sendPending=null;p.reject({code:'pi_disconnected',message:'明确回放：响应断开，输入仍保留，不自动重发。'});}};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(_event,id){listeners.delete(id);}};
  window.__TAURI_INTERNALS__={transformCallback(callback){const id=++callbackId;callbacks.set(id,callback);return id;},unregisterCallback(id){callbacks.delete(id);},invoke:async(command,args)=>{
    const f=window.piFixture;f.calls.push({command,args:structuredClone(args)});
    if(command==='plugin:event|listen'){const id=++eventId;listeners.set(id,args);return id;}
    if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return;}
    if(command==='storage_workspace')return{root:'X:/ExplicitReplay',defaultRoot:'X:/ExplicitReplay',todos:[]};
    if(command==='list_projects')return[];
    if(command==='pi_snapshot')return structuredClone(f.snapshot);
    if(command==='pi_sessions')return {sessions:structuredClone(f.sessions),unreadable:0};
    if(command==='pi_connect'){if(f.mode==='connect-error')throw{code:'pi_start_failed',message:'明确回放：原版启动失败，未使用其他Pi。'};f.ready(args.sessionPath?'fixture-restored':'fixture-session');return structuredClone(f.snapshot);}
    if(command==='pi_send'){
      if(f.mode==='send-error')throw{code:'pi_disconnected',message:'明确回放：发送未确认，输入保留。'};
      if(f.mode==='send-pending')return new Promise((resolve,reject)=>{f.sendPending={resolve,reject,args};});
      f.snapshot.projection.activity=args.input.behavior?'running':'starting';f.event();return {generation:args.input.generation,sessionId:args.input.sessionId,disposition:args.input.behavior?'queued':'started'};
    }
    if(command==='pi_stop'){f.snapshot.projection.activity='idle';f.snapshot.projection.outcome='interrupted';f.snapshot.recoveredQueue=['停止时保留的排队文字'];f.event();return structuredClone(f.snapshot);}
    if(command==='pi_disconnect'){f.snapshot.generation++;f.snapshot.connection='disconnected';f.snapshot.busy=false;f.snapshot.projection.activity='idle';f.snapshot.projection.outcome='interrupted';f.event();return structuredClone(f.snapshot);}
    if(command==='pi_new_session'){f.snapshot.state=state('second-session');f.snapshot.projection=projection();f.snapshot.models=[];f.event();return structuredClone(f.snapshot);}
    if(command==='pi_name_session'){f.snapshot.state.sessionName=args.name;f.event();return structuredClone(f.snapshot);}
    if(command==='pi_select_model'){f.snapshot.state.model={...nativeModel,provider:args.provider,id:args.id};f.event();return structuredClone(f.snapshot);}
    if(command==='pi_save_model'){if(f.mode==='save-error')throw{code:'pi_config_io',message:'明确回放：模型配置不能保存，表单保留。'};f.saved=true;return{saved:true,connected:false,message:'明确回放：配置已保存，但连接失败；不是推理成功。'};}
    throw new Error('Unexpected explicit fixture command: '+command);
  }};
}
module.exports={installPiFixture};
