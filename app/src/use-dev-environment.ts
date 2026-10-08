import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from './desktop-api.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { environmentClient, idleEnvironmentJob } from './dev-environment-client.ts';
import type { EnvironmentJob, EnvironmentPaths, EnvironmentSnapshot } from './dev-environment-client.ts';

export interface EnvironmentController {
  paths: EnvironmentPaths; output: string; snapshot: EnvironmentSnapshot|null;
  job: EnvironmentJob; scanning: boolean; choosing: boolean; error: string; connected: boolean;
  change: (key: keyof EnvironmentPaths, value: string) => void;
  setOutput: (value: string) => void;
  browse: (key: keyof EnvironmentPaths|'output') => Promise<void>;
  inspect: () => Promise<void>; pack: () => Promise<void>; cancel: () => Promise<void>; open: () => Promise<void>;
}
const message = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : '操作未完成，请重试。';
export function useDevEnvironment(visible: boolean): EnvironmentController {
  const connected = isTauri();
  const [paths, setPaths] = useState<EnvironmentPaths>({ herdr: '', openpi: '', skills: 'E:\\skills-manager' });
  const [output, setOutput] = useState('');
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot|null>(null);
  const [job, setJob] = useState<EnvironmentJob>(idleEnvironmentJob);
  const [scanning, setScanning] = useState(false), [choosing, setChoosing] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), initialized = useRef(false), alive = useRef(true);
  const latest = useRef({ paths, output, job }); latest.current = { paths, output, job };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const receive = useCallback((next: EnvironmentJob) => {
    if (!alive.current) return;
    const before = latest.current.job;
    latest.current.job = next; setJob(next);
    if (next.status === 'completed' && before.id === next.id && before.status !== 'completed') notifyOperation('开发环境和 Skills 已分别打包。', { tone: 'success' });
    if (next.status === 'cancelled' && before.id === next.id && before.status !== 'cancelled') notifyOperation('已取消打包。');
  }, []);
  const inspect = useCallback(async () => {
    if (!connected || locked.current || ['running','cancelling'].includes(latest.current.job.status)) return;
    locked.current = true; setScanning(true); setError('');
    try {
      const result = await environmentClient.inspect(latest.current.paths);
      if (alive.current) { setSnapshot(result); setPaths(result.paths); latest.current.paths=result.paths; }
    } catch (failure) { if (alive.current) setError(message(failure)); }
    finally { locked.current=false; if(alive.current) setScanning(false); }
  }, [connected]);
  useEffect(() => {
    if (!visible || !connected || initialized.current) return;
    initialized.current=true;
    void (async () => {
      try { receive(await environmentClient.status()); } catch(failure) { if(alive.current) setError(message(failure)); }
      await inspect();
    })();
  }, [visible, connected, inspect, receive]);
  useEffect(() => {
    if (!connected || !['running','cancelling'].includes(job.status)) return;
    let stopped=false, timer:number|undefined;
    const poll=async () => {
      try { const result=await environmentClient.status(); if(!stopped){receive(result);setError('');} }
      catch(failure){if(!stopped)setError('暂时无法取得打包进度，任务可能仍在进行。'+message(failure));}
      if(!stopped)timer=window.setTimeout(()=>void poll(),700);
    };
    void poll();
    return()=>{stopped=true;window.clearTimeout(timer);};
  }, [connected, job.id, job.status, receive]);
  const change = (key: keyof EnvironmentPaths, value: string) => {
    if(locked.current || ['running','cancelling'].includes(latest.current.job.status))return;
    const next={...latest.current.paths,[key]:value};latest.current.paths=next;setPaths(next);setSnapshot(null);setError('');
  };
  const browse = async (key: keyof EnvironmentPaths|'output') => {
    if(!connected || locked.current || ['running','cancelling'].includes(latest.current.job.status))return;
    locked.current=true;setChoosing(true);setError('');
    try {
      const selected=await environmentClient.pick();
      if(selected && alive.current){
        if(key==='output'){latest.current.output=selected;setOutput(selected);}
        else{const next={...latest.current.paths,[key]:selected};latest.current.paths=next;setPaths(next);setSnapshot(null);}
      }
    } catch(failure){if(alive.current)setError(message(failure));}
    finally{locked.current=false;if(alive.current)setChoosing(false);}
  };
  const pack=async () => {
    if(!connected || locked.current || ['running','cancelling'].includes(latest.current.job.status))return;
    locked.current=true;setScanning(true);setError('');
    try {
      const result=await environmentClient.inspect(latest.current.paths);
      if(!alive.current)return;
      setSnapshot(result);setPaths(result.paths);latest.current.paths=result.paths;
      if(!result.ready)return;
      let destination=latest.current.output;
      if(!destination){destination=await environmentClient.pick()??'';if(!destination)return;setOutput(destination);latest.current.output=destination;}
      receive(await environmentClient.export(result.paths,destination));
    } catch(failure){if(alive.current)setError(message(failure));}
    finally{locked.current=false;if(alive.current)setScanning(false);}
  };
  const cancel=async()=>{try{receive(await environmentClient.cancel());}catch(failure){setError(message(failure));}};
  const open=async()=>{try{await environmentClient.open();}catch(failure){setError(message(failure));}};
  return { paths, output, snapshot, job, scanning, choosing, error, connected, change, setOutput:value=>{if(!locked.current && !['running','cancelling'].includes(latest.current.job.status)){latest.current.output=value;setOutput(value);}}, browse, inspect, pack, cancel, open };
}
