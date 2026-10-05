import type { ProjectDocument } from '../projects-contract.ts';
import type { Idea } from '../ideas-contract.ts';
import type { NewsMaterial, NewsSource } from '../news-contract.ts';
import type { NewsEvent, EditorialConfig, EditorialRun, Edition } from '../news-editorial-contract.ts';
import type { PiSnapshot } from '../pi-client.ts';
import type { ProviderDraft } from '../use-pi-providers.ts';
import type { ModelBoardState, ModelBoard } from '../model-ranking-contract.ts';
import { BOARD_INFO, RANKING_DATASET, RANKING_PRICE_SOURCE } from '../model-ranking-contract.ts';

// 全部为本入口的虚构样例，不读取本机库、会话、认证或当前网络内容。
export const at = '2026-10-04T08:00:00.000Z';
export const root = 'UI fixture / AZCineData';
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const project: ProjectDocument = {
  id: uuid(1), name: '城市漫游 · 视觉短片（示例）', revision: 1, createdAt: at,
  labels: [{id: uuid(2), name: '制作中'}, {id: uuid(3), name: '待核对'}],
  blocks: [
    {id: uuid(4), kind: 'text', title: '创意方向', body: '以城市的光线和材质为线索，组织一段有节奏的视觉短片。\n这是虚构设计资料，用于查看长文、编辑与交付布局。'},
    {id: uuid(5), kind: 'checklist', title: '制作准备', items: [{id: uuid(6), text: '核对分镜和风格参考', checked: true}, {id: uuid(7), text: '整理镜头所需素材', checked: false}]},
    {id: uuid(8), kind: 'list', title: '镜头清单', included: true,
      columns: [{id: uuid(9), name: '镜头', kind: 'shot'}, {id: uuid(10), name: '当前阶段', kind: 'stage'}, {id: uuid(11), name: '当前交期', kind: 'date'}, {id: uuid(12), name: '已交完', kind: 'delivered'}, {id: uuid(13), name: '备注', kind: 'text'}],
      rows: [0,1,2].map(n => ({id: uuid(20+n), cells: {[uuid(9)]: `SH0${n+1}`, [uuid(10)]: uuid(2), [uuid(11)]: '2026-10-06', [uuid(12)]: 'false', [uuid(13)]: n ? '待确认镜头节奏与构图' : '清晨的城市街道'}}))},
  ],
};
export const idea: Idea = {id: uuid(30), title: '用材质变化连接镜头', body: '玻璃、金属、水面之间做一组转场。先留下想法，后续再关联项目。', tags: ['转场','CG'], projectId: project.id, revision: 1, createdAt: at, updatedAt: at, deleted: false, todoId: null};
export const source: NewsSource = {config: {id: 'rss-ui-example', name: '视觉与技术 · 示例信源', feedUrl: 'https://example.com/feed.xml', identity: 'media', domains: ['visual','industry'], usage: 'editorial', intervalMinutes: 60, enabled: true}, revision: 1, createdAt: at, feedKind: 'rss', lastAttemptAt: at, lastSuccessAt: at, lastStatus: 'added', lastError: null};
export const materials: NewsMaterial[] = Array.from({length: 6}, (_, n) => ({id: (n+1).toString(16).repeat(32), sourceId: source.config.id, sourceName: source.config.name, sourceRevision: 1, discoveredAt: at, title: ['实时渲染工作流的新进展（示例）','视觉工具开始支持镜头间的一致性控制（示例）','制作团队分享材质管理经验（示例）','开放模型发布新的推理接口（示例）','创作者讨论 AI 与制作流程（示例）','图像生成工具更新编辑能力（示例）'][n], url: `https://example.com/articles/${n+1}`, publishedAt: at, publishedRaw: null, summary: '这是用于界面总览的虚构资料摘要，展示长文本、来源、时间与处理输入的排版。', summaryTruncated: false}));
export const config: EditorialConfig = {model: {provider: 'ui-example', id: 'example-model'}, domains: (['frontiers','industry','visual'] as const).map(domain => ({domain, enabled: true, rule: '保留与工作有关、能追溯出处的进展；信息缺失时明确标注。', minScore: 50, dailyLimit: 3})), featuredScore: 75, overviewLimit: 3, autoCollect: false, autoDaily: false, dailyTime: '08:00', collectionProxy: null};
export const event: NewsEvent = {id: 'a'.repeat(64), revision: 1, draft: {eventKey: 'ui-example-rendering', materialIds: [materials[0].id], domain: 'visual', title: '实时渲染工具扩展镜头编辑能力（示例）', summary: '示例工具新增材质与镜头编辑能力，帮助创作者组织视觉短片。这里展示中文导读及原始出处的阅读布局。', facts: [{text: '示例公告描述了材质编辑和镜头控制能力。', materialIds: [materials[0].id]}], score: 82, reason: '与视觉制作流程相关，仍需结合实际项目核对。', tags: ['CG','工作流','渲染'], limitations: ['本文为 UI 虚构样例，不代表真实资讯或推荐。'], needsReview: false, hasNewFacts: true}, materials: [materials[0]], generatedAt: at, latestAt: at, configRevision: 1, model: config.model!, promptVersion: 1, featured: true, analysis: {generatedAt: at, model: config.model!, judgments: [{text: '可用于讨论制作流程，实际适用性尚待核对。', materialIds: [materials[0].id]}], limitations: ['尚未在真实项目中验证。']}};
export const edition: Edition = {id: uuid(40), date: '2026-10-04', version: 1, generatedAt: at, windowStart: '2026-10-03T08:00:00.000Z', windowEnd: at, configRevision: 1, overviewIds: [event.id], events: [event], incomplete: false, gaps: []};
export const run: EditorialRun = {id: uuid(41), kind: 'organize', eventId: null, status: 'completed', startedAt: at, finishedAt: at, windowStart: edition.windowStart, windowEnd: at, configRevision: 1, config, total: 1, processed: 1, error: null, scheduleDate: null};
export const piSnapshot: PiSnapshot = {generation: 1, seq: 1, connection: 'ready', busy: false, stopping: false, sending: false, state: {sessionId: uuid(42), sessionFile: null, sessionName: '示例会话', model: {id: 'example-model', name: '示例模型', provider: 'ui-example', api: 'openai-completions', input: ['text','image'], reasoning: true, contextWindow: 128000, maxTokens: 8192}, thinkingLevel: 'medium', isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 0}, models: [{id: 'example-model', name: '示例模型', provider: 'ui-example', api: 'openai-completions', input: ['text','image'], reasoning: true, contextWindow: 128000, maxTokens: 8192}], projection: {messages: [], partial: null, tools: [], steering: [], followUp: [], activity: 'idle', outcome: 'none', notice: null}, recoveredQueue: [], error: null, notice: null, cwd: root, runtime: {piVersion: '示例', nodeVersion: '示例', root: 'UI fixture / runtime'}, paths: {agent: 'UI fixture / pi/agent', sessions: 'UI fixture / pi/sessions', defaultCwd: root}};
export const provider: ProviderDraft = {uid: uuid(43), root, provider: 'ui-example', baseUrl: 'https://example.com/v1', api: 'openai-completions', apiKey: '', hasCredential: true, persisted: true, dirty: false, revision: 0, models: [{uid: uuid(44), persisted: true, id: 'example-model', name: '示例模型', contextWindow: '128000', maxTokens: '8192', reasoning: true, supportsImages: true, baseUrl: '', api: '', limitsAssumed: false}], tab: 'connection', remote: null, fetching: false, error: null, notice: null, selectedIds: [], modelQuery: ''};
export function board(board: ModelBoard): ModelBoardState {
  const metric = {value: 25.6, lower: 21.5, upper: 29.7};
  return {board, snapshotId: 'ui-fixture', savedAt: at, sourceCheck: {day: '2026-10-04', attemptedAt: at}, error: null,
    snapshot: {version: 2, board, category: 'overall', sourceUrl: BOARD_INFO[board].url, datasetUrl: RANKING_DATASET, datasetRevision: 'ui-fixture', datasetLicense: 'CC BY 4.0', dataUpdatedAt: at, capturedAt: at, totalModels: 50, totalSamples: 1200,
      rows: Array.from({length: 50}, (_, n) => board === 'agent' ? {kind: 'agent' as const, rank: n+1, rankLow: n+1, rankHigh: n+2, model: `示例 Agent 模型 ${n+1}`, organization: 'ui-fixture', license: '示例', netImprovement: metric, confirmedSuccess: metric, praiseVsComplaint: metric, steerability: metric} : {kind: 'text-to-image' as const, rank: n+1, rankLow: n+1, rankHigh: n+2, model: `示例图像模型 ${n+1}`, organization: 'ui-fixture', license: '示例', score: 1200-n*5, scoreLower: 1180-n*5, scoreUpper: 1220-n*5, votes: 1000, preliminary: n===2}),
      pricing: {sourceUrl: RANKING_PRICE_SOURCE, capturedAt: at, rows: []}}};
}
