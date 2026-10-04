export const domainLabels = { frontiers: '大模型前沿', industry: 'AI行业动态', visual: 'AI视频、图片 / CG应用' } as const;
export const identityLabels = { official: '官方', research: '研究机构', media: '媒体', individual: '个人' } as const;
export const usageLabels = { editorial: '参与整理', watch: '关注线索' } as const;
export const statusLabels = {
  queued: '等待采集', fetching: '正在抓取', parsing: '正在解析', saving: '正在保存',
  added: '正常有新增', noNew: '正常无新增', fetchFailed: '抓取失败', parseFailed: '解析失败',
  saveFailed: '保存失败', interrupted: '采集中断',
} as const;
export type Domain = keyof typeof domainLabels;
export type SourceIdentity = keyof typeof identityLabels;
export type SourceUsage = keyof typeof usageLabels;
export type RunStatus = keyof typeof statusLabels;
export type FeedKind = 'rss' | 'atom';
export interface SourceConfig {
  id: string; name: string; feedUrl: string; identity: SourceIdentity; domains: Domain[];
  usage: SourceUsage; intervalMinutes: number; enabled: boolean;
}
export interface NewsSource {
  config: SourceConfig; revision: number; createdAt: string; feedKind: FeedKind | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastStatus: RunStatus | null; lastError: string | null;
}
export interface SaveSourceRequest { requestId: string; expectedRevision: number | null; source: SourceConfig }
export interface FeedEntry {
  externalId: string | null; title: string; url: string; publishedAt: string | null;
  publishedRaw: string | null; summary: string | null; summaryTruncated: boolean;
}
export interface NewsMaterial extends Omit<FeedEntry, 'externalId'> {
  id: string; sourceId: string; sourceName: string; sourceRevision: number; discoveredAt: string;
}
export interface CollectionRun {
  id: string; sourceId: string; sourceName: string; sourceRevision: number; startedAt: string; attemptedAt: string;
  finishedAt: string | null; status: RunStatus; fetched: number; added: number; skipped: number;
  error: string | null; warning: string | null; retryStage: 'fetch' | 'parse' | 'save' | null;
}
export interface NewsSnapshot { sources: NewsSource[]; runs: CollectionRun[] }
export interface MaterialPage { items: NewsMaterial[]; total: number; page: number; pageSize: number }
export interface FeedPreview { fetchedAt: string; kind: FeedKind; total: number; skipped: number; warning: string | null; entries: FeedEntry[] }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourceId = /^(?:rss-[a-z0-9-]{1,96}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function invalid(): never { throw new Error('资讯返回的数据不完整，原列表和草稿保持不变。请重新读取核对。'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 10000): string { if (typeof value !== 'string' || value.length > max) return invalid(); return value; }
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
function integer(value: unknown, min = 0): number { if (!Number.isSafeInteger(value) || Number(value) < min) return invalid(); return value as number; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function enumValue<const T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T)) return invalid(); return value as T; }
function timestamp(value: unknown): string { const result = text(value); if (!Number.isFinite(Date.parse(result))) return invalid(); return result; }
function optionalTime(value: unknown): string | null { return value === null ? null : timestamp(value); }
export function safeNewsUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && value.length <= 4096; }
  catch { return false; }
}
function urlValue(value: unknown): string { const result = text(value, 4096); return safeNewsUrl(result) ? result : invalid(); }
export function parseSourceConfig(value: unknown): SourceConfig {
  const c = object(value); const id = text(c.id, 100);
  if (!sourceId.test(id) || !Array.isArray(c.domains)) return invalid();
  const domains = c.domains.map(domain => enumValue(domain, ['frontiers', 'industry', 'visual']));
  const name = text(c.name, 400); const intervalMinutes = integer(c.intervalMinutes, 15);
  if (!name.trim() || [...name].length > 200 || intervalMinutes > 10080 || new Set(domains).size !== domains.length) return invalid();
  return { id, name, feedUrl: urlValue(c.feedUrl), identity: enumValue(c.identity, ['official', 'research', 'media', 'individual']),
    domains, usage: enumValue(c.usage, ['editorial', 'watch']), intervalMinutes, enabled: bool(c.enabled) };
}
export function parseNewsSource(value: unknown): NewsSource {
  const s = object(value);
  return { config: parseSourceConfig(s.config), revision: integer(s.revision, 1), createdAt: timestamp(s.createdAt),
    feedKind: s.feedKind === null ? null : enumValue(s.feedKind, ['rss', 'atom']), lastAttemptAt: optionalTime(s.lastAttemptAt),
    lastSuccessAt: optionalTime(s.lastSuccessAt), lastStatus: s.lastStatus === null ? null : enumValue(s.lastStatus, Object.keys(statusLabels) as RunStatus[]), lastError: nullable(s.lastError) };
}
function parseEntry(value: unknown): FeedEntry {
  const e = object(value); const title = text(e.title, 4000);
  if (!title.trim() || [...title].length > 2000) return invalid();
  return { externalId: e.externalId === undefined ? null : nullable(e.externalId), title, url: urlValue(e.url),
    publishedAt: optionalTime(e.publishedAt), publishedRaw: nullable(e.publishedRaw), summary: nullable(e.summary), summaryTruncated: bool(e.summaryTruncated) };
}
function parseRun(value: unknown): CollectionRun {
  const r = object(value); const id = text(r.id, 64); const sid = text(r.sourceId, 100);
  if (!/^[a-f0-9]{64}$/.test(id) || !sourceId.test(sid)) return invalid();
  return { id, sourceId: sid, sourceName: text(r.sourceName, 400), sourceRevision: integer(r.sourceRevision, 1),
    startedAt: timestamp(r.startedAt), attemptedAt: timestamp(r.attemptedAt), finishedAt: optionalTime(r.finishedAt),
    status: enumValue(r.status, Object.keys(statusLabels) as RunStatus[]), fetched: integer(r.fetched), added: integer(r.added), skipped: integer(r.skipped),
    error: nullable(r.error), warning: nullable(r.warning), retryStage: r.retryStage === null ? null : enumValue(r.retryStage, ['fetch', 'parse', 'save']) };
}
export function parseNewsSnapshot(value: unknown): NewsSnapshot {
  const s = object(value); if (!Array.isArray(s.sources) || !Array.isArray(s.runs)) return invalid();
  const sources = s.sources.map(parseNewsSource); const runs = s.runs.map(parseRun);
  if (new Set(sources.map(source => source.config.id)).size !== sources.length || new Set(runs.map(run => run.id)).size !== runs.length) return invalid();
  return { sources, runs };
}
export function parseMaterialPage(value: unknown): MaterialPage {
  const p = object(value); if (!Array.isArray(p.items)) return invalid();
  const items = p.items.map(value => {
    const m = object(value); const entry = parseEntry(m); const id = text(m.id, 32); const sid = text(m.sourceId, 100);
    if (!/^[a-f0-9]{32}$/.test(id) || !sourceId.test(sid)) return invalid();
    return { id, sourceId: sid, sourceName: text(m.sourceName, 400), sourceRevision: integer(m.sourceRevision, 1), title: entry.title,
      url: entry.url, publishedAt: entry.publishedAt, publishedRaw: entry.publishedRaw, discoveredAt: timestamp(m.discoveredAt), summary: entry.summary, summaryTruncated: entry.summaryTruncated };
  });
  const total = integer(p.total); const pageSize = integer(p.pageSize, 1);
  if (items.length > pageSize || items.length > total || new Set(items.map(item => item.id)).size !== items.length) return invalid();
  return { items, total, page: integer(p.page), pageSize };
}
export function parseFeedPreview(value: unknown): FeedPreview {
  const p = object(value); if (!Array.isArray(p.entries) || p.entries.length > 20) return invalid();
  return { fetchedAt: timestamp(p.fetchedAt), kind: enumValue(p.kind, ['rss', 'atom']), total: integer(p.total), skipped: integer(p.skipped), warning: nullable(p.warning), entries: p.entries.map(parseEntry) };
}
export function validateSource(config: SourceConfig, sources: NewsSource[]): string | null {
  if (!config.name.trim() || [...config.name.trim()].length > 200) return '请填写 1–200 字的信源名称。';
  if (sources.some(source => source.config.id !== config.id && source.config.name.trim().toLocaleLowerCase() === config.name.trim().toLocaleLowerCase())) return '已有同名信源，请换一个名称。';
  if (!safeNewsUrl(config.feedUrl.trim())) return '请填写不含登录凭据的公开 HTTP/HTTPS 订阅地址。';
  if (!Number.isInteger(config.intervalMinutes) || config.intervalMinutes < 15 || config.intervalMinutes > 10080) return '采集频率需为 15–10080 分钟的整数。';
  return null;
}
export function normalizedConfig(config: SourceConfig): SourceConfig { return { ...config, name: config.name.trim(), feedUrl: new URL(config.feedUrl.trim()).href, domains: [...config.domains] }; }
export function equalConfig(a: SourceConfig, b: SourceConfig): boolean {
  return a.id === b.id && a.name === b.name && a.feedUrl === b.feedUrl && a.identity === b.identity && a.usage === b.usage
    && a.intervalMinutes === b.intervalMinutes && a.enabled === b.enabled && [...a.domains].sort().join() === [...b.domains].sort().join();
}
export function validRequestId(id: string): boolean { return uuid.test(id); }
export function formatNewsTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
}
export function publicationLabel(entry: Pick<FeedEntry, 'publishedAt' | 'publishedRaw'>): string {
  return entry.publishedAt ? formatNewsTime(entry.publishedAt) : entry.publishedRaw ? `原时间无法解析：${entry.publishedRaw}` : '信源未提供发布时间';
}
