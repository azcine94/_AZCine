import { Disclosure } from './components/ui/disclosure.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import type { EditorialConfig, ModelChoice } from './news-editorial-contract.ts';
import { pipelineStages } from './news-reader-contract.ts';
import type { PipelineConfig } from './news-reader-contract.ts';
import type { PiModel } from './pi-contract.ts';

function ModelSelect({ label, choice, models, inherited, onChange }: {
  label: string; choice: ModelChoice | null | undefined; models: PiModel[];
  inherited: string; onChange: (choice: ModelChoice | null) => void;
}) {
  return <label>{label}<NativeSelect variant="app" value={choice ? JSON.stringify([choice.provider, choice.id]) : ''} onChange={event => {
    if (!event.target.value) onChange(null);
    else { const [provider, id] = JSON.parse(event.target.value) as [string, string]; onChange({ provider, id }); }
  }}>
    <option value="">{inherited}</option>
    {choice && !models.some(model => model.provider === choice.provider && model.id === choice.id) && <option value={JSON.stringify([choice.provider, choice.id])}>{choice.provider} / {choice.id}（运行时核对）</option>}
    {models.map(model => <option key={JSON.stringify([model.provider, model.id])} value={JSON.stringify([model.provider, model.id])}>{model.name} · {model.provider}</option>)}
  </NativeSelect></label>;
}

export function NewsModelSettings({ config, saved, pipeline, models, update, updatePipeline }: {
  config: EditorialConfig; saved: EditorialConfig | undefined; pipeline: PipelineConfig; models: PiModel[];
  update: (patch: Partial<EditorialConfig>) => void; updatePipeline: (patch: Partial<PipelineConfig>) => void;
}) {
  const overrides = Object.keys(pipeline.models).length;
  return <section className="news-model-settings">
    <div className="news-model-default">
      <ModelSelect label="资讯默认模型" choice={config.model} models={models} inherited="使用本应用可用默认模型" onChange={choice => update({ model: choice })} />
      <div className="news-model-saved meta"><span>已保存的默认模型</span><strong>{saved?.model ? `${saved.model.provider} / ${saved.model.id}` : '本应用可用默认模型'}</strong></div>
    </div>
    <p className="meta">保存后用于新任务；正在运行的任务和原任务重试沿用各自的旧配置。推理强度使用 <UILink variant="text" href="#settings/models">模型高级设置</UILink> 中的默认档位。</p>
    {!models.length && <p className="meta">尚未加载模型列表；连接或保存模型设置后可选择。默认选项在任务开始时核对实际可用模型。</p>}
    <div className="news-preferences-section-heading"><h3>步骤模型</h3><span className="meta">{overrides ? `${overrides} 个步骤单独指定` : '全部继承默认模型'}</span></div>
    <div className="news-model-grid">{Object.entries(pipelineStages).map(([key, label]) => {
      const stage = key as keyof typeof pipelineStages;
      return <ModelSelect key={stage} label={label} choice={pipeline.models[stage]} models={models} inherited="继承资讯默认模型" onChange={choice => {
        const choices = { ...pipeline.models };
        if (choice) choices[stage] = choice; else delete choices[stage];
        updatePipeline({ models: choices });
      }} />;
    })}</div>
    <p className="meta">两次独立评分使用同一评分模型，各自开启新会话，不携带前一次答案。</p>
    <Disclosure className="disclosure"><summary>高级：指定默认模型标识</summary>
      <div className="news-model-grid">
        <label>模型提供商<Input variant="app" value={config.model?.provider ?? ''} maxLength={200} onChange={event => update({ model: { provider: event.target.value, id: config.model?.id ?? '' } })} /></label>
        <label>模型 ID<Input variant="app" value={config.model?.id ?? ''} maxLength={300} onChange={event => update({ model: { provider: config.model?.provider ?? '', id: event.target.value } })} /></label>
      </div>
    </Disclosure>
    <Disclosure className="disclosure"><summary>请求额度 · 每分钟 {pipeline.requestsPerMinute || '不限'} / 每小时 {pipeline.requestsPerHour || '不限'} / 24小时 {pipeline.requestsPerDay || '不限'}</summary>
      <p className="meta">按实际尝试次数累计，成功步骤复用不计新请求；0 表示不限制。超过额度停止，可稍后手动重试。</p>
      <div className="news-quota-grid">{([['requestsPerMinute', '每分钟'], ['requestsPerHour', '每小时'], ['requestsPerDay', '滚动24小时']] as const).map(([key, label]) => <label key={key}>{label}<Input variant="app" type="number" min={0} max={100000} required value={pipeline[key]} onChange={event => updatePipeline({ [key]: event.target.valueAsNumber })} /></label>)}</div>
    </Disclosure>
  </section>;
}
