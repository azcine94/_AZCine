import { BOARD_INFO, MODEL_BOARDS, rankingTime, RANKING_DATASET, RANKING_PRICE_SOURCE } from './model-ranking-contract.ts';
import type { ModelBoard, ModelSnapshot, RankingMetric, RankingRow } from './model-ranking-contract.ts';
import type { ModelRankingController } from './use-model-ranking.ts';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
const priceNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const priceDescription = 'Models.dev 收录的基础 API 报价，美元 / 百万 token，输入 / 输出；推理档位沿用基础模型价。优先厂商直供，悬停报价可查看服务商和采集时间。';
const organizations: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', meta: 'Meta', xai: 'xAI', 'microsoft-ai': 'Microsoft AI', deepseek: 'DeepSeek', moonshot: 'Moonshot', bytedance: 'ByteDance', alibaba: 'Alibaba', tencent: 'Tencent' };
function organization(row: RankingRow) { return row.organization ? organizations[row.organization] ?? row.organization : '厂商未提供'; }
function Icon({ name }: { name: 'agent' | 'image' | 'refresh' | 'external' | 'clock' | 'trophy' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'agent' && <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M8 12v2m8-2v2M9 17h6M1 11v5m22-5v5" /></>}
    {name === 'image' && <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>}
    {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 8a7 7 0 0 1 12-3L20 8M4 16l2.5 3a7 7 0 0 0 12-3" /></>}
    {name === 'external' && <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>}
    {name === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
    {name === 'trophy' && <><path d="M7 3h10v5a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6" /></>}
  </svg>;
}
function ModelName({ row }: { row: RankingRow }) {
  return <span className="ranking-model"><span className="ranking-model-copy">
    <span className="ranking-model-name">{row.model}</span>
    <span className="ranking-model-meta">{organization(row)}{row.license && <><span className="ranking-meta-dot">·</span>{row.license}</>}</span>
    {row.kind === 'text-to-image' && row.preliminary === true && <span className="ranking-preliminary">初步排名</span>}
  </span></span>;
}
function Metric({ value }: { value: RankingMetric }) {
  const direction = value.value > 0 ? 'positive' : value.value < 0 ? 'negative' : 'neutral';
  const symmetric = Math.abs(value.value - (value.lower + value.upper) / 2) < 0.000001;
  return <span className="ranking-metric" data-direction={direction}
    title={`${value.value}% · 置信区间 ${value.lower}% 至 ${value.upper}%`}>
    <strong>{signed.format(value.value)}<small>%</small></strong>
    <span className="ranking-interval">{symmetric ? `±${number.format((value.upper - value.lower) / 2)}%` : `${signed.format(value.lower)}% ~ ${signed.format(value.upper)}%`}</span>
  </span>;
}
function PriceQuote({ snapshot, row }: { snapshot: ModelSnapshot; row: RankingRow }) {
  const price = snapshot.pricing?.rows.find(item => item.model === row.model)?.price;
  if (!price) return <span className="ranking-price-quote" title={snapshot.pricing?.capturedAt
    ? 'Models.dev 暂无可准确匹配的非零输入 / 输出报价。' : '价格尚未采集成功，请刷新榜单。'}><strong>—</strong></span>;
  const time = snapshot.pricing?.capturedAt;
  const title = `${priceDescription}\n${price.providerName} · ${price.kind === 'third-party' ? '第三方' : '厂商直供'}\n输入 $${price.input} / 输出 $${price.output}\n模型 ${price.modelId}\n基础模型 ${price.canonicalModelId}\n价格采集时间 ${time ? rankingTime(time) : '—'} 北京时间`;
  return <span className="ranking-price-quote" title={title}>
    <strong>${priceNumber.format(price.input)} / ${priceNumber.format(price.output)}</strong>
  </span>;
}
function RankingLeaders({ snapshot }: { snapshot: ModelSnapshot }) {
  return <div className="ranking-leaders" aria-label="榜单前三名">{snapshot.rows.slice(0, 3).map((row, index) =>
    <article className="ranking-leader" data-place={index + 1} key={row.model}>
      <div className="ranking-leader-top"><span className="ranking-place"><Icon name="trophy" />第 {row.rank} 名</span><span className="ranking-leader-org">{organization(row)}</span></div>
      <h3 title={row.model}>{row.model}</h3>
      <div className="ranking-leader-bottom"><div><span className="ranking-leader-label">{row.kind === 'agent' ? '好评与投诉' : 'Arena 分数'}</span>
        <strong className="ranking-leader-value" data-direction={row.kind === 'agent' && row.praiseVsComplaint.value < 0 ? 'negative' : 'positive'}>
          {row.kind === 'agent' ? <>{signed.format(row.praiseVsComplaint.value)}<small>%</small></> : number.format(row.score)}
        </strong></div><span className="ranking-leader-detail">{row.kind === 'agent' ? <>价格 · 输入 / 输出<PriceQuote snapshot={snapshot} row={row} /></> : <>票数<strong>{number.format(row.votes)}</strong></>}</span></div>
      <span className="ranking-leader-watermark" aria-hidden="true">{String(row.rank).padStart(2, '0')}</span>
    </article>)}</div>;
}
function RankingTable({ snapshot }: { snapshot: ModelSnapshot }) {
  const agent = snapshot.board === 'agent';
  const hasSpread = snapshot.rows.some(row => row.rankLow !== null && row.rankHigh !== null);
  return <div className="ranking-table-card">
    <div className="ranking-table-heading"><div><span className="ranking-section-mark" aria-hidden="true" /><h3>完整榜单</h3><span className="ranking-count">{snapshot.rows.length}</span></div>
      <span className="ranking-table-label">{agent ? 'Arena 官方综合排名' : '按 Arena 分数排名'}<span aria-hidden="true">↓</span></span></div>
    <div className="ranking-table-scroll" role="region" aria-label={`${BOARD_INFO[snapshot.board].title}前 50 名，窄窗口可用方向键横向滚动`} tabIndex={0}>
      <table className={`ranking-table ranking-table--${snapshot.board}`}>
        <caption className="ranking-table-caption">{BOARD_INFO[snapshot.board].title} · Overall · 前 50 名</caption>
        <colgroup><col className="ranking-col-rank" />{hasSpread && <col className="ranking-col-spread" />}<col />
          {agent ? <><col className="ranking-col-metric" /><col className="ranking-col-price" /></> : <><col className="ranking-col-score" /><col className="ranking-col-votes" /></>}
        </colgroup>
        <thead><tr><th scope="col">排名</th>{hasSpread && <th scope="col">排名范围</th>}<th scope="col">模型 / 厂商</th>
          {agent ? <><th scope="col">好评与投诉</th><th scope="col" title={priceDescription}>价格（$/百万 token）<span className="ranking-price-label">输入 / 输出</span></th></> : <><th scope="col" className="ranking-sort-column">Arena 分数 <span aria-hidden="true">↓</span></th><th scope="col">票数</th></>}
        </tr></thead>
        <tbody>{snapshot.rows.map(row => <tr key={row.model} data-top={row.rank <= 3 ? row.rank : undefined}>
          <td className="ranking-rank"><span className="ranking-rank-badge">{String(row.rank).padStart(2, '0')}</span></td>
          {hasSpread && <td className="ranking-spread">{row.rankLow === null || row.rankHigh === null ? '—' : `${row.rankLow}–${row.rankHigh}`}</td>}
          <th scope="row"><ModelName row={row} /></th>
          {row.kind === 'agent' ? <><td><Metric value={row.praiseVsComplaint} /></td><td className="ranking-price"><PriceQuote snapshot={snapshot} row={row} /></td></> : <>
            <td className="ranking-score" title={`${row.score} · 置信区间 ${row.scoreLower} 至 ${row.scoreUpper}`}><strong>{number.format(row.score)}</strong><span>{number.format(row.scoreLower)} ~ {number.format(row.scoreUpper)}</span></td>
            <td className="ranking-votes">{number.format(row.votes)}</td>
          </>}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function ModelRankingPanel({ model, hasRoot, rootError }: { model: ModelRankingController; hasRoot: boolean; rootError: string }) {
  const { selected, boards } = model;
  const board = boards[selected], snapshot = board.snapshot;
  const waiting = model.loading || model.busy !== null;
  const canUpdate = model.connected && hasRoot && !waiting && !model.loadError && !board.error;
  const sourceContent = <><span>Arena 原榜</span><Icon name="external" /></>;
  const official = model.connected ? <button type="button" className="ranking-source-link" onClick={() => void model.openSource(selected)}>{sourceContent}</button>
    : <a className="ranking-source-link" href={BOARD_INFO[selected].url} target="_blank" rel="noopener noreferrer">{sourceContent}</a>;
  const cancelled = model.notices[selected].startsWith('已取消获取');
  const boardIcon = (id: ModelBoard) => id === 'agent' ? 'agent' as const : 'image' as const;
  return <section className="ranking-board" aria-labelledby="ranking-board-title">
    <header className="ranking-hero">
      <div className="ranking-topline"><span className="ranking-eyebrow"><span aria-hidden="true" />ARENA · 模型表现</span><span className="ranking-top-label">OVERALL / TOP 50</span></div>
      <div className="ranking-heading"><div className="ranking-title-group"><div><h2 id="ranking-board-title">{BOARD_INFO[selected].title}</h2><p className="ranking-subtitle">{selected === 'agent' ? '真实任务中的模型表现' : '从文字到画面的创作能力'}</p></div></div>
        <div className="ranking-actions">{official}<button type="button" className="ranking-refresh" disabled={!canUpdate} onClick={() => void model.update(selected)}><Icon name="refresh" />刷新榜单</button></div>
      </div>
      <div className="ranking-hero-bottom"><div className="ranking-selectors" role="group" aria-label="选择模型榜单">
        {MODEL_BOARDS.map(id => <button type="button" key={id} aria-pressed={id === selected} onClick={() => model.setSelected(id)}>{BOARD_INFO[id].title}</button>)}
      </div><div className="ranking-times"><Icon name="clock" /><span>采集时间</span>{snapshot ? <time dateTime={snapshot.capturedAt}>{rankingTime(snapshot.capturedAt)}<span> 北京时间</span></time> : <span>尚未采集</span>}{cancelled && <span role="status" className="ranking-cancelled">已取消获取</span>}</div></div>
    </header>
    {!model.connected && <p className="ranking-notice">当前为网页预览，请在这个工作目录根运行 npm run dev 打开桌面版。</p>}
    {model.connected && !hasRoot && !rootError && <p className="ranking-notice">先在<a href="#settings">设置中选择数据目录</a>，随后自动获取并保存榜单。</p>}
    {rootError && <p className="ranking-notice ranking-error" role="alert">{rootError}</p>}
    {model.loading && <p className="ranking-notice" role="status">正在读取已保存榜单…</p>}
    {model.busy && <div className="ranking-notice ranking-progress"><span className="ranking-progress-dot" aria-hidden="true" /><span role="status">{BOARD_INFO[model.busy.board].title} · {model.busy.action === 'save' ? '正在保存…' : '正在采集…'}</span>
      {model.busy.action === 'fetch' && <button type="button" className="text-action" onClick={model.cancel}>取消获取</button>}</div>}
    {(model.loadError || board.error) && <div className="ranking-notice ranking-error" role="alert"><p>{model.loadError || board.error?.message}</p><button type="button" className="text-action" disabled={!hasRoot || waiting} onClick={() => void model.refresh()}>重新读取</button></div>}
    {model.errors[selected] && <p className="ranking-notice ranking-error" role="alert">{model.errors[selected]}</p>}
    {snapshot ? <><RankingLeaders snapshot={snapshot} /><RankingTable snapshot={snapshot} /><footer className="ranking-footer"><span>数据来自 <a href={RANKING_DATASET} target="_blank" rel="noopener noreferrer">Arena</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>{selected === 'agent' && <> · 价格 <a href={RANKING_PRICE_SOURCE} target="_blank" rel="noopener noreferrer" title={priceDescription}>Models.dev</a></>}</span><span>展示 {snapshot.rows.length} / {snapshot.totalModels} 个模型</span></footer></>
      : <div className="ranking-empty"><span className="ranking-empty-icon"><Icon name={boardIcon(selected)} /></span><h3>等待获取{BOARD_INFO[selected].title}</h3><p>采集完成后，前 50 名将显示在这里。</p><button type="button" className="ranking-refresh" disabled={!canUpdate} onClick={() => void model.update(selected)}><Icon name="refresh" />开始采集</button></div>}
  </section>;
}
