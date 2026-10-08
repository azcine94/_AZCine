import { useState } from 'react';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.tsx';
import { defaultThinkingMap, supportedThinkingLevels, thinkingLabels, thinkingLevels } from './pi-thinking.ts';
import type { ThinkingLevel, ThinkingLevelMap } from './pi-thinking.ts';
import type { PiProvidersController, ProviderDraft } from './use-pi-providers.ts';

export function ProviderAdvanced({ draft, model }: { draft: ProviderDraft; model: PiProvidersController }) {
  const [selected, setSelected] = useState('');
  const current = draft.models.find(row => row.uid === selected) ?? draft.models[0];
  if (!current) return <p className="meta">请先在模型页添加模型。</p>;
  const edit = (patch: Parameters<PiProvidersController['editModel']>[2]) => model.editModel(draft.uid, current.uid, patch);
  const mapping = current.thinkingLevelMap ?? defaultThinkingMap();
  const levels = supportedThinkingLevels({reasoning:current.reasoning,thinkingLevelMap:mapping});
  const defaultLevel = current.reasoning ? current.defaultThinkingLevel ?? 'medium' : 'off';
  const changeMap = (map: ThinkingLevelMap) => {
    const available = supportedThinkingLevels({ reasoning: current.reasoning, thinkingLevelMap: map });
    edit({ thinkingLevelMap: map, defaultThinkingLevel: available.includes(defaultLevel) ? defaultLevel : available.includes('medium') ? 'medium' : available[0] ?? 'off' });
  };
  return <section className="provider-advanced-layout">
    <div className="provider-advanced-picker"><label className="pi-field">选择要配置的模型<NativeSelect variant="app" value={current.uid} onChange={event => setSelected(event.target.value)}>{draft.models.map(row => <option key={row.uid} value={row.uid}>{row.name || row.id || '未命名模型'}</option>)}</NativeSelect></label><span className="meta">共 {draft.models.length} 个模型 · 切换保留修改</span></div>
    <div className="provider-advanced-section"><h3>长度与输入能力</h3><p className="meta">按服务商提供的规格填写。</p>
      <div className="provider-advanced-grid"><label className="pi-field">上下文长度<Input variant="app" inputMode="numeric" value={current.contextWindow} onChange={event => edit({ contextWindow: event.target.value })} /></label><label className="pi-field">最大输出长度<Input variant="app" inputMode="numeric" value={current.maxTokens} onChange={event => edit({ maxTokens: event.target.value })} /></label></div>
      <label className="provider-capability"><Checkbox checked={current.supportsImages} onCheckedChange={value => edit({ supportsImages: value === true })} />支持图片输入</label>
    </div>
    <div className="provider-advanced-section"><h3>推理强度</h3>
      <label className="provider-capability"><Checkbox checked={current.reasoning} onCheckedChange={value => {
        const enabled = value === true;
        const map = enabled ? defaultThinkingMap() : mapping;
        const supported = supportedThinkingLevels({ reasoning: enabled, thinkingLevelMap: map });
        edit({ reasoning: enabled, thinkingLevelMap: map, defaultThinkingLevel: enabled && supported.includes('medium') ? 'medium' : supported[0] ?? 'off' });
      }} />模型支持推理</label>
      <div className="provider-advanced-grid"><label className="pi-field">默认推理档位<NativeSelect variant="app" disabled={!current.reasoning} value={defaultLevel} onChange={event => edit({ defaultThinkingLevel: event.target.value as ThinkingLevel })}>
        {!levels.includes(defaultLevel) && <option value={defaultLevel}>原默认档位不可用，请重新选择</option>}
        {levels.map(level => <option key={level} value={level}>{thinkingLabels[level]} · {level}</option>)}
      </NativeSelect></label><p className="meta provider-thinking-help">保存后，新会话和资讯任务使用此默认档位。Agent 内可随时选择本次会话的强度。</p></div>
      {current.reasoning && <Disclosure className="provider-thinking-details"><summary>档位设置</summary>
        <p className="meta">默认填入全部档位，可按需调整。</p>
        <Table className="table-fixed" containerProps={{className:'provider-thinking-table'}}>
          <colgroup><col style={{width:'24%'}}/><col style={{width:'36%'}}/><col style={{width:'40%'}}/></colgroup>
          <TableHeader><TableRow><TableHead scope="col">推理档位</TableHead><TableHead scope="col">使用方式</TableHead><TableHead scope="col">接口参数</TableHead></TableRow></TableHeader>
          <TableBody>{thinkingLevels.map(level => {
          const value = mapping[level];
          return <TableRow key={level}><TableCell className="whitespace-normal"><span className="provider-thinking-label">{thinkingLabels[level]}<small className="meta">{level}</small></span></TableCell><TableCell>
            <NativeSelect variant="app" aria-label={`${level}档位映射方式`} value={value === undefined ? 'inherit' : value === null ? 'disabled' : 'custom'} onChange={event => {
              const next = { ...mapping };
              if (event.target.value === 'inherit') delete next[level]; else next[level] = event.target.value === 'disabled' ? null : level === 'off' ? 'none' : level;
              changeMap(next);
            }}><option value="inherit">自动</option><option value="disabled">不启用</option><option value="custom">指定参数</option></NativeSelect></TableCell>
            <TableCell>{typeof value === 'string' ? <Input variant="app" aria-label={`${level}的接口参数`} maxLength={100} value={value} onChange={event => changeMap({ ...mapping, [level]: event.target.value })} /> : <span className="meta">—</span>}</TableCell>
          </TableRow>;
        })}</TableBody></Table>
      </Disclosure>}
    </div>
    <Disclosure><summary>单独配置模型接口</summary><div className="provider-advanced-grid">
      <label className="pi-field">模型 Base URL<Input variant="app" value={current.baseUrl} onChange={event => edit({ baseUrl: event.target.value })} placeholder="留空使用服务商地址" spellCheck={false} /></label>
      <label className="pi-field">模型 API 类型<NativeSelect variant="app" value={current.api} onChange={event => edit({ api: event.target.value })}><option value="">使用服务商类型</option><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="google-generative-ai">Google Generative AI</option></NativeSelect></label>
    </div></Disclosure>
  </section>;
}
