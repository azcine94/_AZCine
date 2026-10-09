export interface EvolutionSettings { automatic:boolean;time:string;budget:number;model:{provider:string;id:string}|null;allowed:string[] }
export interface EvolutionSource {path:string;session:string;title:string;message:string;ordinal:number;timestamp:string;quote:string}
export interface EvolutionCandidate {id:string;title:string;kind:string;target:string;before:string;after:string;baseHash:string|null;source:EvolutionSource;status:string;createdAt:string;revision:number}
export interface EvolutionRun {id:string;trigger:string;status:string;startedAt:string;finishedAt:string|null;messages:number;candidates:number;error:string|null}
export interface EvolutionChange {id:string;candidates:string[];target:string;before:string|null;after:string;status:string;at:string}
export interface EvolutionResource {id:string;path:string;content:string;hash:string|null}
export interface EvolutionSnapshot {busy:boolean;resources:EvolutionResource[];state:{revision:number;settings:EvolutionSettings;candidates:EvolutionCandidate[];runs:EvolutionRun[];changes:EvolutionChange[]}}
export function selectRange(selected:Set<string>,visible:string[],anchor:string|null,id:string,checked:boolean,shift:boolean):Set<string>{
  const next=new Set(selected),end=visible.indexOf(id),start=anchor?visible.indexOf(anchor):-1;
  if(end<0)return next;
  const ids=shift&&start>=0?visible.slice(Math.min(start,end),Math.max(start,end)+1):[id];
  for(const key of ids){if(checked)next.add(key);else next.delete(key);}return next;
}
