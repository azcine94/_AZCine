// Browser-only replay. Never loaded by application startup or native Pi.
function installTitleFixture() {
  window.isTauri = true;
  const callbacks = new Map(), listeners = new Map();
  let callbackId = 0, listenerId = 0;
  const state = {sessionId:'title-fixture',sessionFile:'X:/ExplicitTitleRefresh/pi/sessions/title.jsonl',sessionName:null,model:null,thinkingLevel:'off',isStreaming:false,isCompacting:false,pendingMessageCount:0,messageCount:0};
  const f = window.titleFixture = {
    snapshot:{generation:1,seq:1,connection:'ready',busy:false,stopping:false,sending:false,state,models:[],projection:{messages:[],partial:null,tools:[],steering:[],followUp:[],activity:'idle',outcome:'none',notice:null},recoveredQueue:[],error:null,notice:null,cwd:'X:/ExplicitTitleRefresh/workspace',runtime:null,paths:null},
    sessions:[{id:state.sessionId,path:state.sessionFile,name:null,cwd:'X:/ExplicitTitleRefresh/workspace',updatedAt:'2026-10-07T00:00:00Z',messageCount:0}],
    calls:[],holdSummary:false,heldSummary:null,holdSessions:false,heldSessions:null,
    summary(){const conversations=[{conversationKey:'default',generation:1,seq:this.snapshot.seq,connection:'ready',active:false,waiting:false,sessionId:state.sessionId,sessionFile:state.sessionFile,name:state.sessionName,outcome:'none',cwd:this.snapshot.cwd}];if(this.background)conversations.push(this.background);return {replyLimit:3,revision:1,active:0,conversations};},
    emit(conversationKey='default'){for(const [id,l] of listeners)if(l.event==='azcine-pi-changed')callbacks.get(l.handler)?.({id,event:l.event,payload:{conversationKey}});},
    rename(name){state.sessionName=name;this.sessions[0].name=name;this.snapshot.seq++;this.emit();},
    releaseSummary(){this.heldSummary.resolve(this.heldSummary.value);this.heldSummary=null;},
    releaseSessions(){this.heldSessions.resolve(this.heldSessions.value);this.heldSessions=null;}
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(_event,id){listeners.delete(id);}};
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback){const id=++callbackId;callbacks.set(id,callback);return id;},
    unregisterCallback(id){callbacks.delete(id);},
    async invoke(command,args){
      f.calls.push({command,args});
      if(command==='plugin:event|listen'){const id=++listenerId;listeners.set(id,args);return id;}
      if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return;}
      if(command==='pi_snapshot')return structuredClone(f.snapshot);
      if(command==='pi_runtime_summary'){
        const value=structuredClone(f.summary());
        if(f.holdSummary){f.holdSummary=false;return new Promise(resolve=>f.heldSummary={resolve,value});}
        return value;
      }
      if(command==='pi_sessions'){
        const value={sessions:structuredClone(f.sessions),unreadable:0};
        if(f.holdSessions){f.holdSessions=false;return new Promise(resolve=>f.heldSessions={resolve,value});}
        return value;
      }
      throw Error('Unexpected title replay IPC: '+command);
    }
  };
}
module.exports = {installTitleFixture};
