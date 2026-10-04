import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PiController } from './use-pi.ts';
export function RuntimeInfo({model}:{model:PiController}){const s=model.snapshot;return <details className="pi-runtime"><summary>工作目录与原版 Pi</summary><dl><dt>版本</dt><dd>{s?.runtime?`Pi ${s.runtime.piVersion} · Node ${s.runtime.nodeVersion}`:'尚未启动'}</dd><dt>运行文件</dt><dd>{s?.runtime?.root??'使用本应用独立资源，不调用系统其他 Pi'}</dd><dt>工作目录</dt><dd>{s?.cwd??'默认本应用工作目录'}</dd><dt>资源与配置</dt><dd>{s?.paths?.agent??'数据根内 pi/agent'}</dd><dt>原生会话</dt><dd>{s?.paths?.sessions??'数据根内 pi/sessions'}</dd></dl><label className="pi-field">下次连接的工作目录（空白使用应用默认）<input value={model.cwd} onChange={e=>model.setCwd(e.target.value)} placeholder="可选绝对目录" spellCheck={false}/></label><p className="subtle">默认不加载外部项目资源，不改原版核心。独立目录不是文件权限沙箱；扩展与原生终端交接在 S04 接入。</p></details>;}
function Feedback({model}:{model:PiController}){return <>{(model.error??model.snapshot?.error?.message)&&<p className="form-error" role="alert">{model.error??model.snapshot?.error?.message}</p>}{model.notice&&<p role="status">{model.notice}</p>}{model.snapshot?.notice&&<p role="status">{model.snapshot.notice}</p>}</>;}
export function PiSettings({model}:{model:PiController}){
  const form=model.modelForm,[error,setError]=useState<string|null>(null),s=model.snapshot;
  const busy=!!model.action||!!s?.busy||!!s?.stopping;
  async function save(e:FormEvent){e.preventDefault();setError(null);const context=Number(form.contextWindow),max=Number(form.maxTokens);if(!/^\d+$/.test(form.contextWindow)||!/^\d+$/.test(form.maxTokens)||!Number.isSafeInteger(context)||context<=0||!Number.isSafeInteger(max)||max<=0){setError('上下文和最大输出需为正整数，输入仍保留。');return;}
    const sent={...form};if(await model.saveModel({...form,contextWindow:context,maxTokens:max,apiKey:form.apiKey||null}))model.setModelForm(current=>current.apiKey===sent.apiKey?{...current,apiKey:''}:current);
  }
  return <section className="foundation-section pi-settings" aria-labelledby="pi-settings-title"><h2 id="pi-settings-title">模型连接</h2><p className="subtle">只保存到本应用。使用原版 Pi 的模型与认证机制，不读取其他 Pi 的密钥。</p>
    {!model.root?<p>请先选择数据目录，再保存模型设置。</p>:<form className="pi-model-form" onSubmit={e=>void save(e)}>
      <div className="pi-fields"><label className="pi-field">服务标识<input required maxLength={80} value={form.provider} onChange={e=>model.setModelForm({...form,provider:e.target.value})} placeholder="例如 my-provider" spellCheck={false}/></label><label className="pi-field">原生 API 类型<select value={form.api} onChange={e=>model.setModelForm({...form,api:e.target.value})}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="google-generative-ai">Google Generative AI</option></select></label></div>
      <label className="pi-field">API 地址<input required value={form.baseUrl} onChange={e=>model.setModelForm({...form,baseUrl:e.target.value})} placeholder="https://…" spellCheck={false}/></label>
      <div className="pi-fields"><label className="pi-field">模型 ID<input required value={form.modelId} onChange={e=>model.setModelForm({...form,modelId:e.target.value})} spellCheck={false}/></label><label className="pi-field">显示名称<input required value={form.name} onChange={e=>model.setModelForm({...form,name:e.target.value})}/></label></div>
      <div className="pi-fields"><label className="pi-field">上下文长度<input inputMode="numeric" value={form.contextWindow} onChange={e=>model.setModelForm({...form,contextWindow:e.target.value})}/></label><label className="pi-field">最大输出长度<input inputMode="numeric" value={form.maxTokens} onChange={e=>model.setModelForm({...form,maxTokens:e.target.value})}/></label></div>
      <div className="pi-actions"><label className="pi-check"><input type="checkbox" checked={form.reasoning} onChange={e=>model.setModelForm({...form,reasoning:e.target.checked})}/>声明支持思考</label><label className="pi-check"><input type="checkbox" checked={form.supportsImages} onChange={e=>model.setModelForm({...form,supportsImages:e.target.checked})}/>声明支持图片</label></div>
      <label className="pi-field">API Key<input type="password" autoComplete="off" value={form.apiKey} onChange={e=>model.setModelForm({...form,apiKey:e.target.value})} placeholder="留空保留此服务原有认证" spellCheck={false}/></label><p className="meta">不回显已有密钥。服务不要求认证时，请按服务说明填写它接受的值；不自动编造 Key。关闭额外缓存保活与自动重试。</p>
      {error&&<p className="form-error" role="alert">{error}</p>}<button className="pill on" disabled={busy||!model.connected}>保存并由原版加载</button>
    </form>}
    <Feedback model={model}/><div className="pi-actions"><button className="pill" onClick={()=>void model.connect()} disabled={busy||!model.root||!model.connected}>连接 / 重新读取</button>{s?.connection==='ready'&&<a className="foundation-link" href="#agent">打开 Agent</a>}</div>
    <p className="subtle">{s?.connection==='ready'?`原版已加载 ${s.models.length} 个可用模型；列入清单不等于端点已通过真实回复验证。`:s?.connection==='connecting'?'正在启动本应用原版 Pi…':'尚未连接。保存失败时表单保留，不自动调用模型。'}</p>
    <RuntimeInfo model={model}/>
  </section>;
}
