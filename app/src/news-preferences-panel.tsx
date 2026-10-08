import { useId } from 'react';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { StatusDot } from './components/ui/status-dot.tsx';
import { NewsSourceRules } from './news-source-rules.tsx';
import { NewsModelSettings } from './news-model-settings.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Button } from './components/ui/button.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Input } from './components/ui/input.tsx';
import type {NewsSource} from './news-contract.ts';
import {defaultPipeline} from './news-reader-contract.ts';
import type {PipelineConfig,SourceRule} from './news-reader-contract.ts';
import type { EditorialController } from './use-news-editorial.ts';
import { equalEditorial } from './news-editorial-contract.ts';
import { EditorialFeedback } from './news-reading-panels.tsx';
import type { PiModel } from './pi-contract.ts';
export function NewsPreferences({ model, models = [], sources=[], section = 'domains' }: { model: EditorialController; models?: PiModel[]; sources?:NewsSource[]; section?: 'domains' | 'ai' | 'automation' }) {
  const formId = useId();
  const title = { domains: '分类与筛选', ai: 'AI 处理', automation: '采集与日报' }[section];
  const draft = model.draft; const config = draft?.config;
  if (!draft || !config) return <section className="news-page"><h2 className="title">{title}</h2><EditorialFeedback model={model} /><Button variant="app-pill" className="pill" disabled={model.loading || !model.connected} onClick={() => void model.refresh()}>{model.loading ? '正在读取…' : '读取资讯配置'}</Button></section>;
  const dirty = !!model.snapshot && !equalEditorial(config, model.snapshot.preferences.config);
  const update = (patch: Partial<typeof config>) => model.changeConfig({ ...config, ...patch });
  const pipeline=config.pipeline??defaultPipeline();
  const updatePipeline=(patch:Partial<PipelineConfig>)=>update({pipeline:{...pipeline,...patch}});
  const sourceRule=(s:NewsSource):SourceRule=>pipeline.sources.find(r=>r.sourceId===s.config.id)??{sourceId:s.config.id,tier:s.config.identity==='official'||s.config.identity==='research'?'T1':'T2',fetchBody:true,displayBody:true};
  const updateSource=(s:NewsSource,patch:Partial<SourceRule>)=>updatePipeline({sources:[...pipeline.sources.filter(r=>r.sourceId!==s.config.id),{...sourceRule(s),...patch}]});
  const saveState = model.busy ? '正在保存…' : model.pending ? '保存回执待核对' : dirty ? '有未保存改动' : '与已保存配置一致';
  return <section className={`news-page news-preferences news-preferences--${section}`}>
    <header className="news-preferences-header">
      <div><h2 className="title">{title}</h2><p className="meta">配置 v{model.snapshot?.preferences.revision} · 三个配置页共用草稿，保存后用于新任务</p></div>
      <div className="news-preferences-save">
        <StatusBadge tone={dirty || model.pending ? 'warning' : 'neutral'} role="status"><StatusDot aria-hidden="true" label={saveState} tone={dirty || model.pending ? 'warning' : 'neutral'} />{saveState}</StatusBadge>
        {model.pending && <Button variant="outline" type="button" disabled={!!model.busy} onClick={() => void model.reconcile()}>核对上次保存</Button>}
        <Button form={formId} type="submit" disabled={!!model.busy || !model.connected}>{model.busy ? '正在保存…' : model.pending ? '重发上次保存请求' : '保存资讯配置'}</Button>
      </div>
    </header>
    <div className="news-preferences-scroll">
    <EditorialFeedback model={model} />
    <form id={formId} className="news-source-form news-rules-form" onInvalidCapture={event => {
      let details = (event.target as HTMLElement).closest('details');
      while (details) { details.open = true; details = details.parentElement?.closest('details') ?? null; }
    }} onSubmit={event => { event.preventDefault(); void model.save(); }}>
      {section === 'automation' && <fieldset className="news-domain-fields"><legend>订阅网络</legend>
        <p className="meta">当前已保存：{model.snapshot?.preferences.config.collectionProxy != null ? '手动 HTTP 代理' : '直连'}。保存后用于下一次信源预览、采集和抓取失败重试；正在采集的任务沿用开始时的设置。</p>
        <label>采集连接方式<NativeSelect variant="app" className="select" value={config.collectionProxy == null ? 'direct' : 'proxy'} onChange={e => update({ collectionProxy: e.target.value === 'proxy' ? '' : null })}><option value="direct">直连</option><option value="proxy">手动 HTTP 代理</option></NativeSelect></label>
        {config.collectionProxy != null && <><label>代理地址<Input variant="app" className="input" type="url" required maxLength={512} value={config.collectionProxy} onChange={e => update({ collectionProxy: e.target.value })} placeholder="http://127.0.0.1:7890" autoComplete="off" spellCheck={false} /></label><p className="meta">填写代理软件的 HTTP 或 Mixed 地址，示例端口需要替换为实际端口。仅支持 http://，不支持 SOCKS 地址或需要登录的代理。代理软件需要保持运行，域名解析由所填代理负责。</p></>}
        <p className="meta">不自动读取系统代理。此设置用于 RSS / Atom、公开正文与配图采集，AI 模型连接单独配置。保存后可回到信源管理，先预览或重试一个失败信源；旧错误记录会保留。</p>
        <UILink variant="text" className="foundation-link" href="#settings/news">前往信源管理 →</UILink>
      </fieldset>}
      {section === 'domains' && <>
        <Disclosure className="disclosure news-classification-guide"><summary>AIHOT 分类与筛选规则 · T1 ≥60 / T1.5 ≥65 / T2 ≥76</summary>
          <p className="meta">模型 · 产品 · 行业 · 论文 · 教程 · 观点。宽召回 AI 相关性预筛，BLOCK 停止后续处理，UNKNOWN 缺材料时保留待补。</p>
          <p className="meta">通过预筛后独立评分两次，按平均值与来源档位决定精选；EXCLUDE_MP 不参与评分。未精选且平均值超过50，也走内容理解，其余走中文标题与摘要。</p>
          <p className="meta">分类、标签与提示词沿用 AIHOT。来源等级是本机声明，不自动证明机构身份；只读取公开页面，不带登录信息。</p>
        </Disclosure>
        <NewsSourceRules sources={sources} rule={sourceRule} onChange={updateSource} />
      </>}
      {section === 'ai' && <NewsModelSettings config={config} saved={model.snapshot?.preferences.config} pipeline={pipeline} models={models} update={update} updatePipeline={updatePipeline} />}
      {section === 'automation' && <fieldset className="news-domain-fields"><legend>采集与运行</legend><label className="choice"><Input variant="inline" type="checkbox" checked={config.autoCollect} onChange={e => update({ autoCollect: e.target.checked })} />按信源频率自动采集</label><label className="choice"><Input variant="inline" type="checkbox" checked={config.autoDaily} onChange={e => update({ autoDaily: e.target.checked })} />自动生成每日固定日报</label><label>日报时间（北京时间）<Input variant="app" className="input" type="time" required value={config.dailyTime} onChange={e => update({ dailyTime: e.target.value })} /></label><p className="meta">本应用实际运行时检查；当日时点后启动且未跑则补一次，不补多天。日报按北京时间08:00截止，从已完成结果成刊，不调用模型整理待处理材料；暂停保留历史。关闭主窗口当前会退出，托盘运行等待后台模块接入。模型处理遇到临时连接或服务故障最多自动重试3次，可能产生调用费用；耗尽后保留进度，可在记录中手动重试。</p></fieldset>}
      {model.pending && <p className="warn-t">上次保存回执待核对，草稿仍保留。可核对结果或重发同一个请求，不创建重复配置版本。</p>}
      {draft.revision !== model.snapshot?.preferences.revision && <p className="warn-t">正式配置已有更新，草稿基于 v{draft.revision}。<Button variant="app-text" type="button" className="text-action" disabled={!!model.pending} onClick={model.rebase}>保留草稿并对照最新版本</Button></p>}
      <p className="meta news-preferences-footnote">切页保留输入，保存失败保留草稿。旧刊不重写。<UILink variant="text" className="foundation-link" href="#jobs">查看后台任务与运行记录 →</UILink></p>
    </form>
    </div>
  </section>;
}
