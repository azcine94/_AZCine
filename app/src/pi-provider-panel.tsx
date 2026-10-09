import { FormDialog } from './components/ui/form-dialog.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { ProviderAdvanced } from './pi-provider-advanced.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { useState } from 'react';
import type { PiController } from './use-pi.ts';
import type { PiProvidersController } from './use-pi-providers.ts';

const apiTypes=[['openai-completions','OpenAI Chat Completions'],['openai-responses','OpenAI Responses'],['anthropic-messages','Anthropic Messages'],['google-generative-ai','Google Generative AI']] as const;
function ApiOptions(){return <>{apiTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</>;}
export function PiProviderPanel({model,pi}:{model:PiProvidersController;pi:PiController}){
  const [deletion,setDeletion]=useState<{uid:string;provider:string;modelId?:string}|null>(null),[deleteError,setDeleteError]=useState('');
  async function remove(){if(!deletion)return;setDeleteError('');try{await model.remove(deletion.uid,deletion.modelId);setDeletion(null);}catch(e){setDeleteError(e instanceof Error?e.message:'删除未完成。');}}
  const [query,setQuery]=useState(''),d=model.active,s=pi.snapshot;
  const connecting=s?.connection==='connecting'||pi.action==='连接';
  const busy=pi.viewing||connecting||!!model.saving||!!pi.action||!!s?.busy||!!s?.stopping||!!s?.sending||!!s&&s.projection.activity!=='idle';
  const available=!!pi.root&&pi.connected;
  const saveDisabled=!available||!model.ready||busy||!d||!d.dirty||model.loading||!!model.loadError;
  const providers=model.providers.filter(v=>`${v.provider} ${v.models.map(m=>`${m.id} ${m.name}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const candidates=d?.remote?.models.filter(m=>`${m.id} ${m.name}`.toLowerCase().includes(d.modelQuery.toLowerCase()))??[];
  const connectionError=pi.error??s?.error?.message??pi.modelCatalogError;
  const connection=connecting?'Pi 正在连接…':pi.viewing?'正在读取 Pi 状态…':s?.connection==='ready'?'Pi 已连接':s?.connection==='error'?'Pi 连接失败':'Pi 尚未连接';
  return <section className="settings-page provider-page">
    <header className="settings-page-header provider-page-header"><div><h2>模型服务商</h2><p className="subtle">添加多个服务商，为每个服务商选择可用模型。</p></div><div className="pi-actions"><Button variant="app-pill" type="button" className="pill on" disabled={saveDisabled} onClick={()=>d&&void model.save(d.uid)}>{model.saving?'正在保存…':'保存此服务商'}</Button><Button variant="app-pill" type="button" className="pill" disabled={!available||!model.ready||model.loading||!!model.loadError} onClick={model.addProvider}>＋ 添加服务商</Button></div></header>
    <div className="provider-page-scroll">
    <div className="provider-status"><span role="status">{connection}</span>{s?.connection==='ready'?<UILink variant="text" className="foundation-link" href="#agent">打开 Agent →</UILink>:<Button variant="app-pill" type="button" className="pill" disabled={!available||busy} onClick={()=>void pi.connect()}>{connecting?'正在连接…':'重试连接'}</Button>}</div>
    {connectionError && d?.error !== connectionError && <Feedback as="p" tone="error" className="form-error" role="alert">{connectionError}{connectionError===pi.modelCatalogError&&<Button type="button" variant="app-quiet" disabled={pi.modelCatalogLoading} onClick={()=>void pi.refreshModels()}>{pi.modelCatalogLoading?'正在重试…':'重试读取模型'}</Button>}</Feedback>}
    {!available&&<p className="subtle">{!pi.root?'请先在数据设置中选择有效的数据目录。':'请在桌面版配置服务商。'} <UILink variant="text" className="foundation-link" href="#settings/data">数据设置 →</UILink></p>}
    {model.loadError&&<div className="provider-load-error"><Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback><Button variant="app-pill" type="button" className="pill" disabled={model.loading} onClick={()=>void model.reload()}>重新读取服务商</Button></div>}
    <div className="provider-manager" aria-busy={model.loading}>
      <aside className="provider-sidebar" aria-label="服务商列表"><label className="pi-field"><span className="sr-only">搜索服务商或模型</span><Input variant="inline" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索服务商或模型" /></label><div className="provider-list-heading"><span className="meta">{model.loading?'正在读取…':model.ready?`${model.providers.length} 个服务商`:'尚未取得服务商列表'}</span><Button variant="app-control" type="button" className="provider-refresh" disabled={!available||model.loading||busy} onClick={()=>void model.reload()} aria-label="重新读取服务商">↻</Button></div>
        <div className="provider-list">{providers.map(v=><Button variant="app-control" type="button" className="provider-list-item" key={v.uid} aria-pressed={v.uid===d?.uid} onClick={()=>model.select(v.uid)}><strong>{v.provider}</strong><span className="meta">{v.models.length} 个模型 · {v.dirty?'未保存':v.persisted?'已保存':'草稿'}</span><span className="provider-credential">{v.hasCredential?'已配置认证':v.apiKey?'Key 待保存':'未配置认证'}</span></Button>)}</div>
        {!providers.length&&!model.loading&&model.ready&&<p className="meta">{model.providers.length?'没有匹配的服务商。':'还没有添加服务商。'}</p>}
      </aside>
      {!d?<EmptyState as="div" className="provider-empty"><h3>{model.ready?'添加第一个服务商':model.loading?'正在读取服务商配置…':'等待读取服务商配置'}</h3><p className="subtle">填写 API 地址和 Key，获取模型列表后选择要使用的模型。</p><Button variant="app-pill" className="pill on" type="button" disabled={!available||!model.ready||model.loading||!!model.loadError} onClick={model.addProvider}>＋ 添加服务商</Button></EmptyState>:<div className="provider-detail">
        <header className="provider-detail-header"><div><strong>{d.provider}</strong><span className="provider-count">{d.models.length} 个模型</span><p className="meta">{d.baseUrl||'尚未填写 API 地址'}</p></div><div className="pi-actions"><span className="meta">{d.dirty?'有未保存更改':'已保存'}</span><Button variant="app-quiet" disabled={busy||d.persisted&&d.dirty} onClick={()=>{setDeleteError('');setDeletion({uid:d.uid,provider:d.provider});}}>删除服务商</Button></div></header>
        <div className="provider-tabs" role="tablist" aria-label="服务商配置">{([['connection','连接配置'],['models','模型'],['advanced','高级设置']] as const).map(([tab,label])=><Button variant="app-provider-tab" key={tab} id={`provider-tab-${tab}`} type="button" role="tab" aria-selected={d.tab===tab} aria-controls={`provider-content-${tab}`} tabIndex={d.tab===tab?0:-1} onClick={()=>model.ui(d.uid,{tab})} onKeyDown={e=>{const tabs=['connection','models','advanced'] as const;let next:number|undefined;if(e.key==='ArrowRight')next=(tabs.indexOf(tab)+1)%3;else if(e.key==='ArrowLeft')next=(tabs.indexOf(tab)+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;if(next!==undefined){e.preventDefault();model.ui(d.uid,{tab:tabs[next]});document.getElementById(`provider-tab-${tabs[next]}`)?.focus();}}}>{label}</Button>)}</div>
        <div className="provider-detail-body" role="tabpanel" id={`provider-content-${d.tab}`} aria-labelledby={`provider-tab-${d.tab}`}>
          {d.tab==='connection'&&<div className="provider-connection-form">
            <label className="provider-field"><span>服务商标识</span><div><Input variant="inline" value={d.provider} maxLength={80} disabled={d.persisted||model.saving===d.uid} onChange={e=>model.edit(d.uid,{provider:e.target.value})} spellCheck={false} /><p className="meta">英文、数字、点、横线或下划线；保存后固定。</p></div></label>
            <label className="provider-field"><span>Base URL</span><div><Input variant="inline" value={d.baseUrl} type="url" onChange={e=>model.edit(d.uid,{baseUrl:e.target.value})} placeholder="https://…/v1" spellCheck={false}/><p className="meta">填写服务商的 API 基础地址，通常包含 /v1；不填写聊天网页地址。</p></div></label>
            <label className="provider-field"><span>API 类型</span><NativeSelect variant="inline" value={d.api} onChange={e=>model.edit(d.uid,{api:e.target.value})}><ApiOptions/></NativeSelect></label>
            <label className="provider-field"><span>API Key</span><div><Input variant="inline" type="password" value={d.apiKey} autoComplete="off" spellCheck={false} onChange={e=>model.edit(d.uid,{apiKey:e.target.value})} placeholder={d.hasCredential?'已有认证，留空保留':'填写服务商 Key；无需认证可留空'}/><p className="meta">{d.hasCredential?'已配置认证，原密钥不回显。':'尚未配置认证。'}</p></div></label>
            <div className="provider-fetch-row"><Button variant="app-pill" className="pill on" type="button" disabled={!available||d.fetching||!d.baseUrl.trim()||busy} onClick={()=>void model.fetchModels(d.uid)}>{d.fetching?'正在获取模型…':'获取模型'}</Button><span className="meta">从这个服务商获取实际模型列表，再选择添加。</span></div>
          </div>}
          {d.tab==='models'&&<>
            <div className="provider-section-heading"><h3>已添加的模型</h3><div className="pi-actions"><Button variant="app-pill" className="pill" type="button" disabled={!available||busy||d.models.length>=200} onClick={()=>model.addManual(d.uid)}>＋ 手动添加</Button><Button variant="app-pill" className="pill" type="button" disabled={!available||d.fetching||!d.baseUrl.trim()||busy} onClick={()=>void model.fetchModels(d.uid)}>{d.fetching?'正在获取…':'获取模型'}</Button></div></div>
            {!d.models.length&&<p className="provider-inline-empty">还没有模型。获取列表后勾选添加，或手动填写模型 ID。</p>}
            <div className="provider-models">{d.models.map(m=><div className="provider-model-row" key={m.uid}><label className="pi-field"><span className="sr-only">模型 ID</span><Input variant="inline" value={m.id} disabled={m.persisted||model.saving===d.uid} onChange={e=>model.editModel(d.uid,m.uid,{id:e.target.value})} spellCheck={false}/></label><label className="pi-field"><span className="sr-only">显示名称</span><Input variant="inline" value={m.name} onChange={e=>model.editModel(d.uid,m.uid,{name:e.target.value})} placeholder={m.id||'使用模型 ID'}/></label>{m.persisted?<Button variant="app-quiet" disabled={busy||d.dirty} onClick={()=>{setDeleteError('');setDeletion({uid:d.uid,provider:d.provider,modelId:m.id});}} aria-label={`删除模型 ${m.id}`}>删除</Button>:<Button variant="app-control" type="button" className="provider-remove" disabled={model.saving===d.uid} onClick={()=>model.removeNew(d.uid,m.uid)} aria-label={`移除未保存模型 ${m.id||'草稿'}`}>移除</Button>}</div>)}</div>
            {d.models.some(m=>m.limitsAssumed)&&<p className="settings-help">未返回长度参数的模型暂用上下文 32768、最大输出 4096；请按服务商说明在高级设置中调整。</p>}
            {d.remote&&<section className="provider-discovery"><div className="provider-section-heading"><h3>服务商模型列表</h3><Button variant="app-pill" type="button" className="pill on" disabled={!d.selectedIds.length||busy} onClick={()=>model.addSelected(d.uid)}>添加选中（{d.selectedIds.length}）</Button></div><label className="pi-field"><span className="sr-only">搜索可选模型</span><Input variant="inline" type="search" value={d.modelQuery} onChange={e=>model.ui(d.uid,{modelQuery:e.target.value})} placeholder="搜索模型名称或 ID"/></label>
              {d.remote.truncated&&<p className="meta">列表较大，仅显示本次读取的前 {d.remote.models.length} 个模型；其他模型可手动添加。</p>}
              <div className="provider-candidates">{candidates.map(m=>{const added=d.models.some(row=>row.id===m.id);return <label className="provider-candidate" key={m.id}><Input variant="inline" type="checkbox" disabled={added||busy} checked={added||d.selectedIds.includes(m.id)} onChange={e=>model.ui(d.uid,{selectedIds:e.target.checked?[...d.selectedIds,m.id]:d.selectedIds.filter(v=>v!==m.id)})}/><span><strong>{m.name}</strong><small>{m.id}</small></span>{added&&<span className="meta">已添加</span>}</label>;})}</div>{!candidates.length&&<p className="meta">{d.remote.models.length?'没有匹配的模型。':'服务商返回的列表为空。'}</p>}
            </section>}
          </>}
          {d.tab==='advanced'&&<ProviderAdvanced key={d.uid} draft={d} model={model}/>}
          {d.error&&<Feedback as="p" tone="error" className="form-error" role="alert">{d.error}</Feedback>}
        </div>
      </div>}
    </div>
    </div>
  <FormDialog open={!!deletion} onOpenChange={open=>{if(!open&&!model.saving)setDeletion(null);}} title={deletion?.modelId?'删除模型':'删除服务商'} description="删除会写入本应用配置。正在执行的任务保留原配置，历史会话和输入草稿保留。" footer={<><Button disabled={!!model.saving} onClick={()=>setDeletion(null)}>取消</Button><Button disabled={!!model.saving} onClick={()=>void remove()}>{model.saving?'正在删除…':'确认删除'}</Button></>}><p>{deletion?.provider}{deletion?.modelId?` / ${deletion.modelId}`:' 及其全部模型和认证'}</p><p className="subtle">若删除当前默认模型，将清除默认选择；资讯设置或待发送队列仍引用时会阻止删除，请先处理相关引用。系统内置模型不在此处删除。</p>{deleteError&&<Feedback tone="error" role="alert">{deleteError}</Feedback>}</FormDialog></section>;
}
